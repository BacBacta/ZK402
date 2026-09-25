//! Dépense d'une note du pool blindé sur Solana, en UNE instruction :
//!  1. vérifie la preuve de réclamation (Noir → Groth16 via Sunspot, 5 entrées publiques :
//!     root, nullifier, recipient, relayer, fee) ;
//!  2. lit le nullificateur DANS les entrées publiques de la preuve (pas un argument libre) ;
//!  3. crée un compte compressé Light à l'adresse dérivée de ce nullificateur : si l'adresse
//!     existe déjà (note déjà dépensée), le programme système Light rejette la transaction.
//!
//! Test de coût (CU, octets, lamports). Hors périmètre ici : vérification que `root` est une
//! racine connue de l'arbre du pool, transfert des fonds au destinataire.
//! Création des nullificateurs : d'après l'exemple `zk/nullifier` de Light Protocol
//! (github.com/Lightprotocol/program-examples).
#![allow(unexpected_cfgs)]
#![allow(deprecated)]

mod generated_vk;

use anchor_lang::prelude::*;
use gnark_verifier_solana::{GnarkProof, GnarkVerifier, GnarkWitness};
use light_sdk::account::LightAccount;
use light_sdk::address::{v2::derive_address, NewAddressParamsAssignedPacked};
use light_sdk::cpi::v2::{CpiAccounts, LightSystemProgramCpi};
use light_sdk::cpi::{InvokeLightSystemProgram, LightCpiInstruction};
use light_sdk::instruction::{PackedAddressTreeInfo, ValidityProof};
use light_sdk::{derive_light_cpi_signer, CpiSigner, LightDiscriminator, PackedAddressTreeInfoExt};

declare_id!("9KYiaHzahJoob44pnj8WuNKxBnavXUn13AJyDdjtZsKy");

pub const LIGHT_CPI_SIGNER: CpiSigner =
    derive_light_cpi_signer!("9KYiaHzahJoob44pnj8WuNKxBnavXUn13AJyDdjtZsKy");
pub const NULLIFIER_PREFIX: &[u8] = b"nullifier";

const NR_INPUTS: usize = generated_vk::VK.nr_pubinputs;
const N_COMMITMENTS: usize = generated_vk::VK.commitment_keys.len();
/// En-tête gnark du témoin public (3 × u32) avant les entrées.
const PW_HEADER: usize = 12;
/// Position du nullificateur parmi les entrées publiques (root = 0, nullifier = 1).
const NULLIFIER_INPUT: usize = 1;

#[error_code]
pub enum SpendError {
    #[msg("Preuve invalide")]
    InvalidProof,
    #[msg("Témoin public mal formé")]
    BadWitness,
    #[msg("Comptes Light insuffisants")]
    AccountNotEnoughKeys,
    #[msg("Arbre d'adresses invalide")]
    InvalidAddressTree,
}

#[derive(Clone, Debug, AnchorSerialize, AnchorDeserialize)]
pub struct LightData {
    pub proof: ValidityProof,
    pub address_tree_info: PackedAddressTreeInfo,
    pub output_state_tree_index: u8,
    pub system_accounts_offset: u8,
}

#[derive(Clone, Debug, Default, AnchorSerialize, AnchorDeserialize, LightDiscriminator)]
pub struct NullifierAccount {}

#[program]
pub mod spend {
    use super::*;

    pub fn spend<'info>(
        ctx: Context<'info, Spend<'info>>,
        groth16_proof: Vec<u8>,
        public_witness: Vec<u8>,
        light: LightData,
    ) -> Result<()> {
        // 1. Preuve
        if public_witness.len() != PW_HEADER + NR_INPUTS * 32 {
            return err!(SpendError::BadWitness);
        }
        let proof = GnarkProof::<N_COMMITMENTS>::from_bytes(&groth16_proof)
            .map_err(|_| SpendError::InvalidProof)?;
        let witness = GnarkWitness::from_bytes(&public_witness).map_err(|_| SpendError::BadWitness)?;
        let mut verifier: GnarkVerifier<NR_INPUTS> = GnarkVerifier::new(&generated_vk::VK);
        verifier.verify(proof, witness).map_err(|_| SpendError::InvalidProof)?;

        // 2. Nullificateur lu dans les entrées publiques prouvées
        let off = PW_HEADER + NULLIFIER_INPUT * 32;
        let mut nullifier = [0u8; 32];
        nullifier.copy_from_slice(&public_witness[off..off + 32]);

        // 3. Nullificateur compressé (échoue si déjà créé)
        let cpi_accounts = CpiAccounts::new(
            ctx.accounts.signer.as_ref(),
            &ctx.remaining_accounts[light.system_accounts_offset as usize..],
            LIGHT_CPI_SIGNER,
        );
        let tree = light
            .address_tree_info
            .get_tree_pubkey(&cpi_accounts)
            .map_err(|_| SpendError::AccountNotEnoughKeys)?;
        if tree.to_bytes() != light_sdk::constants::ADDRESS_TREE_V2 {
            return err!(SpendError::InvalidAddressTree);
        }
        let (address, seed) = derive_address(&[NULLIFIER_PREFIX, nullifier.as_slice()], &tree, &crate::ID);
        let account = LightAccount::<NullifierAccount>::new_init(&crate::ID, Some(address), light.output_state_tree_index);
        let params: Vec<NewAddressParamsAssignedPacked> =
            vec![light.address_tree_info.into_new_address_params_assigned_packed(seed, Some(0))];
        LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, light.proof)
            .with_light_account(account)?
            .with_new_addresses(&params)
            .invoke(cpi_accounts)?;
        msg!("depense acceptee");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Spend<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
}
