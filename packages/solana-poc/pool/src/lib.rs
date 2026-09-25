//! Pool blindé minimal sur Solana (test de faisabilité, NON audité).
//!
//! - `initialize` : crée le pool pour un jeton SPL (USDC ou autre) et une coupure fixe.
//! - `deposit(commitment)` : transfère la coupure vers le coffre du pool et insère l'engagement
//!   C = H(nk, secret) dans l'arbre de Merkle incrémental on-chain (Poseidon natif, profondeur 20,
//!   historique des ROOT_HISTORY dernières racines).
//! - `spend` : en une instruction,
//!     1. vérifie que la racine prouvée est une racine connue du pool ;
//!     2. vérifie que le destinataire et le relayeur prouvés sont exactement les comptes payés,
//!        et que les frais prouvés ne dépassent pas la coupure ;
//!     3. vérifie la preuve Groth16 (Noir → gnark via Sunspot) ;
//!     4. crée le nullificateur compressé Light (échec si déjà dépensé) ;
//!     5. paie `coupure − frais` au destinataire et `frais` au relayeur depuis le coffre.
//!
//! Entrées publiques de la preuve, dans l'ordre : root, nullifier, recipient, relayer, fee.
//! Un compte Solana (32 octets) est représenté dans le corps BN254 par ses 31 derniers octets
//! (octet de poids fort mis à zéro) : trouver un autre compte avec les mêmes 31 octets demande
//! ≈ 2^248 essais.
#![allow(unexpected_cfgs)]
#![allow(deprecated)]

mod generated_vk;

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
};
use gnark_verifier_solana::{GnarkProof, GnarkVerifier, GnarkWitness};
use light_sdk::account::LightAccount;
use light_sdk::address::{v2::derive_address, NewAddressParamsAssignedPacked};
use light_sdk::cpi::v2::{CpiAccounts, LightSystemProgramCpi};
use light_sdk::cpi::{InvokeLightSystemProgram, LightCpiInstruction};
use light_sdk::instruction::{PackedAddressTreeInfo, ValidityProof};
use light_sdk::{derive_light_cpi_signer, CpiSigner, LightDiscriminator, PackedAddressTreeInfoExt};
use solana_poseidon::{hashv, Endianness, Parameters};

declare_id!("DMBrPRJ7H5hPaJ14T5sVfKQavD71PrkmXFiRDh32S2V8");

pub const LIGHT_CPI_SIGNER: CpiSigner =
    derive_light_cpi_signer!("DMBrPRJ7H5hPaJ14T5sVfKQavD71PrkmXFiRDh32S2V8");
pub const NULLIFIER_PREFIX: &[u8] = b"nullifier";
pub const DEPTH: usize = 20;
pub const ROOT_HISTORY: usize = 30;

const NR_INPUTS: usize = generated_vk::VK.nr_pubinputs;
const N_COMMITMENTS: usize = generated_vk::VK.commitment_keys.len();
const PW_HEADER: usize = 12;
const IN_ROOT: usize = 0;
const IN_NULLIFIER: usize = 1;
const IN_RECIPIENT: usize = 2;
const IN_RELAYER: usize = 3;
const IN_FEE: usize = 4;

#[error_code]
pub enum PoolError {
    #[msg("Preuve invalide")]
    InvalidProof,
    #[msg("Témoin public mal formé")]
    BadWitness,
    #[msg("Racine inconnue du pool")]
    UnknownRoot,
    #[msg("Le destinataire payé n'est pas celui de la preuve")]
    RecipientMismatch,
    #[msg("Le relayeur payé n'est pas celui de la preuve")]
    RelayerMismatch,
    #[msg("Frais supérieurs à la coupure")]
    FeeTooHigh,
    #[msg("Arbre plein")]
    TreeFull,
    #[msg("Engagement invalide")]
    BadCommitment,
    #[msg("Comptes Light insuffisants")]
    AccountNotEnoughKeys,
    #[msg("Arbre d'adresses invalide")]
    InvalidAddressTree,
    #[msg("Erreur Poseidon")]
    Poseidon,
    #[msg("Compte de jetons invalide")]
    BadTokenAccount,
}

#[account(zero_copy)]
#[repr(C)]
pub struct Pool {
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub denomination: u64,
    pub next_index: u32,
    pub root_index: u32,
    pub roots: [[u8; 32]; ROOT_HISTORY],
    pub filled: [[u8; 32]; DEPTH],
    pub zeros: [[u8; 32]; DEPTH],
    pub bump: u8,
    pub _pad: [u8; 7],
}

impl Pool {
    pub const SIZE: usize = 8 + core::mem::size_of::<Pool>();

    fn is_known_root(&self, root: &[u8; 32]) -> bool {
        *root != [0u8; 32] && self.roots.iter().any(|r| r == root)
    }
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

#[event]
pub struct Deposited {
    pub commitment: [u8; 32],
    pub leaf_index: u32,
    pub root: [u8; 32],
}

fn h(a: &[u8; 32], b: &[u8; 32]) -> Result<[u8; 32]> {
    hashv(Parameters::Bn254X5, Endianness::BigEndian, &[a, b])
        .map(|x| x.to_bytes())
        .map_err(|_| error!(PoolError::Poseidon))
}

/// Compte Solana → élément du corps BN254 (31 derniers octets, grand-boutiste).
pub fn pubkey_to_field(k: &Pubkey) -> [u8; 32] {
    let mut f = k.to_bytes();
    f[0] = 0;
    f
}

fn input(pw: &[u8], i: usize) -> [u8; 32] {
    let mut x = [0u8; 32];
    x.copy_from_slice(&pw[PW_HEADER + i * 32..PW_HEADER + (i + 1) * 32]);
    x
}

/// Programme SPL Token (classique). L'USDC de Solana est un jeton SPL classique.
pub const TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/// Lit (mint, propriétaire) d'un compte de jetons SPL après avoir vérifié son programme
/// propriétaire et sa taille.
fn token_account(ai: &AccountInfo) -> Result<(Pubkey, Pubkey)> {
    require_keys_eq!(*ai.owner, TOKEN_PROGRAM_ID, PoolError::BadTokenAccount);
    let d = ai.try_borrow_data()?;
    require!(d.len() == 165, PoolError::BadTokenAccount);
    Ok((Pubkey::new_from_array(d[0..32].try_into().unwrap()), Pubkey::new_from_array(d[32..64].try_into().unwrap())))
}

/// Instruction SPL Token `Transfer` (discriminant 3, montant u64 LE).
fn transfer_ix(from: &Pubkey, to: &Pubkey, authority: &Pubkey, amount: u64) -> Instruction {
    let mut data = vec![3u8];
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![AccountMeta::new(*from, false), AccountMeta::new(*to, false), AccountMeta::new_readonly(*authority, true)],
        data,
    }
}

/// Module BN254 (grand-boutiste) : un engagement doit être un élément canonique du corps.
const FIELD_MODULUS: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

#[program]
pub mod pool {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, denomination: u64) -> Result<()> {
        // Le coffre est un compte de jetons créé par le client, dont le propriétaire est le PDA
        // du pool : seul le programme peut en sortir des fonds.
        let (vmint, vowner) = token_account(&ctx.accounts.vault)?;
        require_keys_eq!(vowner, ctx.accounts.pool.key(), PoolError::BadTokenAccount);
        let bump = ctx.bumps.pool;
        let p = &mut ctx.accounts.pool.load_init()?;
        p.mint = vmint;
        p.vault = ctx.accounts.vault.key();
        p.denomination = denomination;
        p.next_index = 0;
        p.root_index = 0;
        p.bump = bump;
        let mut z = [0u8; 32];
        for i in 0..DEPTH {
            p.zeros[i] = z;
            p.filled[i] = z;
            z = h(&z, &z)?;
        }
        p.roots = [[0u8; 32]; ROOT_HISTORY];
        p.roots[0] = z; // racine de l'arbre vide
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, commitment: [u8; 32]) -> Result<()> {
        require!(commitment < FIELD_MODULUS && commitment != [0u8; 32], PoolError::BadCommitment);
        let p = &mut ctx.accounts.pool.load_mut()?;
        require!((p.next_index as usize) < (1usize << DEPTH), PoolError::TreeFull);
        let (dmint, _) = token_account(&ctx.accounts.depositor_token)?;
        require_keys_eq!(dmint, p.mint, PoolError::BadTokenAccount);
        invoke(
            &transfer_ix(ctx.accounts.depositor_token.key, ctx.accounts.vault.key, ctx.accounts.depositor.key, p.denomination),
            &[ctx.accounts.depositor_token.to_account_info(), ctx.accounts.vault.to_account_info(), ctx.accounts.depositor.to_account_info()],
        )?;
        let leaf_index = p.next_index;
        let mut idx = leaf_index;
        let mut cur = commitment;
        for i in 0..DEPTH {
            if idx % 2 == 0 {
                p.filled[i] = cur;
                cur = h(&cur, &p.zeros[i])?;
            } else {
                cur = h(&p.filled[i], &cur)?;
            }
            idx /= 2;
        }
        let ri = ((p.root_index + 1) % ROOT_HISTORY as u32) as usize;
        p.root_index = ri as u32;
        p.roots[ri] = cur;
        p.next_index += 1;
        emit!(Deposited { commitment, leaf_index, root: cur });
        Ok(())
    }

    pub fn spend<'info>(
        ctx: Context<'info, Spend<'info>>,
        groth16_proof: Vec<u8>,
        public_witness: Vec<u8>,
        light: LightData,
    ) -> Result<()> {
        require!(public_witness.len() == PW_HEADER + NR_INPUTS * 32, PoolError::BadWitness);
        // Ne lit que les champs utiles (copier tout le compte sur la pile la ferait déborder).
        let (known_root, denomination, mint, bump) = {
            let p = ctx.accounts.pool.load()?;
            (p.is_known_root(&input(&public_witness, IN_ROOT)), p.denomination, p.mint, p.bump)
        };

        // 1-2. Contrôles bon marché avant la vérification de la preuve.
        require_keys_eq!(token_account(&ctx.accounts.recipient_token)?.0, mint, PoolError::BadTokenAccount);
        require_keys_eq!(token_account(&ctx.accounts.relayer_token)?.0, mint, PoolError::BadTokenAccount);
        require!(known_root, PoolError::UnknownRoot);
        require!(
            input(&public_witness, IN_RECIPIENT) == pubkey_to_field(&ctx.accounts.recipient_token.key()),
            PoolError::RecipientMismatch
        );
        require!(
            input(&public_witness, IN_RELAYER) == pubkey_to_field(&ctx.accounts.relayer_token.key()),
            PoolError::RelayerMismatch
        );
        let fee_bytes = input(&public_witness, IN_FEE);
        require!(fee_bytes[..24].iter().all(|b| *b == 0), PoolError::FeeTooHigh);
        let fee = u64::from_be_bytes(fee_bytes[24..].try_into().unwrap());
        require!(fee <= denomination, PoolError::FeeTooHigh);

        // 3. Preuve.
        let proof = GnarkProof::<N_COMMITMENTS>::from_bytes(&groth16_proof).map_err(|_| PoolError::InvalidProof)?;
        let witness = GnarkWitness::from_bytes(&public_witness).map_err(|_| PoolError::BadWitness)?;
        let mut verifier: GnarkVerifier<NR_INPUTS> = GnarkVerifier::new(&generated_vk::VK);
        verifier.verify(proof, witness).map_err(|_| PoolError::InvalidProof)?;

        // 4. Nullificateur compressé (lu dans les entrées prouvées).
        let nullifier = input(&public_witness, IN_NULLIFIER);
        let cpi_accounts = CpiAccounts::new(
            ctx.accounts.signer.as_ref(),
            &ctx.remaining_accounts[light.system_accounts_offset as usize..],
            LIGHT_CPI_SIGNER,
        );
        let tree = light
            .address_tree_info
            .get_tree_pubkey(&cpi_accounts)
            .map_err(|_| PoolError::AccountNotEnoughKeys)?;
        require!(tree.to_bytes() == light_sdk::constants::ADDRESS_TREE_V2, PoolError::InvalidAddressTree);
        let (address, seed) = derive_address(&[NULLIFIER_PREFIX, nullifier.as_slice()], &tree, &crate::ID);
        let account = LightAccount::<NullifierAccount>::new_init(&crate::ID, Some(address), light.output_state_tree_index);
        let params: Vec<NewAddressParamsAssignedPacked> =
            vec![light.address_tree_info.into_new_address_params_assigned_packed(seed, Some(0))];
        LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, light.proof)
            .with_light_account(account)?
            .with_new_addresses(&params)
            .invoke(cpi_accounts)?;

        // 5. Paiements depuis le coffre (signé par le PDA du pool).
        let seeds: &[&[u8]] = &[b"pool", mint.as_ref(), &[bump]];
        let signer_seeds = &[seeds];
        let amount = denomination - fee;
        let pool_key = ctx.accounts.pool.key();
        let vault = ctx.accounts.vault.to_account_info();
        let pool_ai = ctx.accounts.pool.to_account_info();
        invoke_signed(
            &transfer_ix(vault.key, ctx.accounts.recipient_token.key, &pool_key, amount),
            &[vault.clone(), ctx.accounts.recipient_token.to_account_info(), pool_ai.clone()],
            signer_seeds,
        )?;
        if fee > 0 {
            invoke_signed(
                &transfer_ix(vault.key, ctx.accounts.relayer_token.key, &pool_key, fee),
                &[vault.clone(), ctx.accounts.relayer_token.to_account_info(), pool_ai.clone()],
                signer_seeds,
            )?;
        }
        msg!("depense acceptee : {} au destinataire, {} au relayeur", amount, fee);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: mint du jeton ; seul sert de graine (le coffre doit être de ce mint).
    pub mint: UncheckedAccount<'info>,
    #[account(init, payer = payer, space = Pool::SIZE, seeds = [b"pool", mint.key().as_ref()], bump)]
    pub pool: AccountLoader<'info, Pool>,
    /// CHECK: compte de jetons vérifié dans `initialize` (programme, mint, propriétaire = pool).
    #[account(constraint = vault.owner == &TOKEN_PROGRAM_ID)]
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub depositor: Signer<'info>,
    #[account(mut, seeds = [b"pool", pool.load()?.mint.as_ref()], bump = pool.load()?.bump)]
    pub pool: AccountLoader<'info, Pool>,
    /// CHECK: doit être le coffre enregistré.
    #[account(mut, address = pool.load()?.vault)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: compte de jetons du déposant, vérifié dans `deposit`.
    #[account(mut)]
    pub depositor_token: UncheckedAccount<'info>,
    /// CHECK: programme SPL Token.
    #[account(address = TOKEN_PROGRAM_ID)]
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Spend<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(seeds = [b"pool", pool.load()?.mint.as_ref()], bump = pool.load()?.bump)]
    pub pool: AccountLoader<'info, Pool>,
    /// CHECK: doit être le coffre enregistré.
    #[account(mut, address = pool.load()?.vault)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: compte de jetons vérifié dans `spend` (mint) et lié à la preuve.
    #[account(mut)]
    pub recipient_token: UncheckedAccount<'info>,
    /// CHECK: compte de jetons vérifié dans `spend` (mint) et lié à la preuve.
    #[account(mut)]
    pub relayer_token: UncheckedAccount<'info>,
    /// CHECK: programme SPL Token.
    #[account(address = TOKEN_PROGRAM_ID)]
    pub token_program: UncheckedAccount<'info>,
}
