//! Pool blindé JOIN-SPLIT sur Solana (montants libres, rendu de monnaie) — test, NON audité.
//!
//! Note : C = H(H(pk, blinding), montant), pk = H(sk, 0) ; nullificateur = H(nk, C), nk = H(sk, 1).
//! Conformité : chaque pool a un CONTRÔLEUR (`screener`) qui doit co-signer tout dépôt. Le
//! service de contrôle (hors chaîne) vérifie le déposant (listes de sanctions) avant de signer.
//! `transact` publie aussi un message chiffré (≤ MAX_MEMO octets) dans l'événement
//! `Transacted` : la note de sortie chiffrée pour son destinataire. Le programme ne peut pas
//! vérifier ce chiffré ; le destinataire, lui, recalcule l'engagement après déchiffrement.
//! - `initialize` : pool pour un jeton SPL (coffre = compte de jetons du PDA du pool).
//! - `deposit(inner, montant)` : transfère `montant` vers le coffre et insère
//!   C = H(inner, montant) calculé ON-CHAIN (le montant de la note est donc celui déposé).
//! - `transact` (preuve join-split 2 → 2) : racine connue ; destinataire et relayeur payés =
//!   ceux de la preuve ; vérification Groth16 ; 2 nullificateurs compressés Light (échec si l'un
//!   existe déjà) ; insertion des 2 engagements de sortie ; paiement public `withdraw` au
//!   destinataire et `fee` au relayeur. Le circuit garantit entrées = sorties + withdraw + fee.
//!
//! Entrées publiques (ordre) : root, nullifier0, nullifier1, out0, out1, withdraw, fee,
//! recipient, relayer. Un compte Solana est représenté par ses 31 derniers octets.
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

declare_id!("H9YGaz5zPS1LXAjhDFnpj88UQGYbDoy64UQJtXBVnzno");

pub const LIGHT_CPI_SIGNER: CpiSigner =
    derive_light_cpi_signer!("H9YGaz5zPS1LXAjhDFnpj88UQGYbDoy64UQJtXBVnzno");
pub const NULLIFIER_PREFIX: &[u8] = b"nullifier";
pub const DEPTH: usize = 20;
pub const ROOT_HISTORY: usize = 30;
pub const MAX_MEMO: usize = 128;
pub const TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

const NR_INPUTS: usize = generated_vk::VK.nr_pubinputs;
const N_COMMITMENTS: usize = generated_vk::VK.commitment_keys.len();
const PW_HEADER: usize = 12;
const IN_ROOT: usize = 0;
const IN_NULL0: usize = 1;
const IN_OUT0: usize = 3;
const IN_WITHDRAW: usize = 5;
const IN_FEE: usize = 6;
const IN_RECIPIENT: usize = 7;
const IN_RELAYER: usize = 8;

const FIELD_MODULUS: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

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
    #[msg("Montant invalide")]
    BadAmount,
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
    #[msg("Message chiffré trop long")]
    MemoTooLong,
    #[msg("Dépôt non co-signé par le contrôleur du pool")]
    NotScreened,
}

#[account(zero_copy)]
#[repr(C)]
pub struct Pool {
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub screener: Pubkey,
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

    /// Insère une feuille dans l'arbre incrémental ; renvoie (indice, nouvelle racine).
    fn insert(&mut self, leaf: &[u8; 32]) -> Result<(u32, [u8; 32])> {
        require!((self.next_index as usize) < (1usize << DEPTH), PoolError::TreeFull);
        let leaf_index = self.next_index;
        let mut idx = leaf_index;
        let mut cur = *leaf;
        for i in 0..DEPTH {
            if idx % 2 == 0 {
                self.filled[i] = cur;
                cur = h(&cur, &self.zeros[i])?;
            } else {
                cur = h(&self.filled[i], &cur)?;
            }
            idx /= 2;
        }
        let ri = ((self.root_index + 1) % ROOT_HISTORY as u32) as usize;
        self.root_index = ri as u32;
        self.roots[ri] = cur;
        self.next_index += 1;
        Ok((leaf_index, cur))
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
    pub amount: u64,
}

#[event]
pub struct Transacted {
    pub nullifiers: [[u8; 32]; 2],
    pub commitments: [[u8; 32]; 2],
    pub first_leaf_index: u32,
    pub withdraw: u64,
    pub fee: u64,
    pub memo: Vec<u8>,
}

fn h(a: &[u8; 32], b: &[u8; 32]) -> Result<[u8; 32]> {
    hashv(Parameters::Bn254X5, Endianness::BigEndian, &[a, b])
        .map(|x| x.to_bytes())
        .map_err(|_| error!(PoolError::Poseidon))
}

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

fn u64_input(pw: &[u8], i: usize) -> Result<u64> {
    let x = input(pw, i);
    require!(x[..24].iter().all(|b| *b == 0), PoolError::BadAmount);
    Ok(u64::from_be_bytes(x[24..].try_into().unwrap()))
}

fn token_account(ai: &AccountInfo) -> Result<(Pubkey, Pubkey)> {
    require_keys_eq!(*ai.owner, TOKEN_PROGRAM_ID, PoolError::BadTokenAccount);
    let d = ai.try_borrow_data()?;
    require!(d.len() == 165, PoolError::BadTokenAccount);
    Ok((Pubkey::new_from_array(d[0..32].try_into().unwrap()), Pubkey::new_from_array(d[32..64].try_into().unwrap())))
}

fn transfer_ix(from: &Pubkey, to: &Pubkey, authority: &Pubkey, amount: u64) -> Instruction {
    let mut data = vec![3u8];
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![AccountMeta::new(*from, false), AccountMeta::new(*to, false), AccountMeta::new_readonly(*authority, true)],
        data,
    }
}

#[program]
pub mod jspool {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, screener: Pubkey) -> Result<()> {
        let (vmint, vowner) = token_account(&ctx.accounts.vault)?;
        require_keys_eq!(vowner, ctx.accounts.pool.key(), PoolError::BadTokenAccount);
        require_keys_eq!(vmint, ctx.accounts.mint.key(), PoolError::BadTokenAccount);
        let bump = ctx.bumps.pool;
        let p = &mut ctx.accounts.pool.load_init()?;
        p.mint = vmint;
        p.vault = ctx.accounts.vault.key();
        p.screener = screener;
        p.bump = bump;
        let mut z = [0u8; 32];
        for i in 0..DEPTH {
            p.zeros[i] = z;
            p.filled[i] = z;
            z = h(&z, &z)?;
        }
        p.roots[0] = z;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, inner: [u8; 32], amount: u64) -> Result<()> {
        require!(amount > 0, PoolError::BadAmount);
        require!(inner < FIELD_MODULUS && inner != [0u8; 32], PoolError::BadCommitment);
        let mint = ctx.accounts.pool.load()?.mint;
        require_keys_eq!(token_account(&ctx.accounts.depositor_token)?.0, mint, PoolError::BadTokenAccount);
        invoke(
            &transfer_ix(ctx.accounts.depositor_token.key, ctx.accounts.vault.key, ctx.accounts.depositor.key, amount),
            &[ctx.accounts.depositor_token.to_account_info(), ctx.accounts.vault.to_account_info(), ctx.accounts.depositor.to_account_info()],
        )?;
        let mut a = [0u8; 32];
        a[24..].copy_from_slice(&amount.to_be_bytes());
        let commitment = h(&inner, &a)?; // le montant de la note est celui réellement déposé
        let (leaf_index, _) = ctx.accounts.pool.load_mut()?.insert(&commitment)?;
        emit!(Deposited { commitment, leaf_index, amount });
        Ok(())
    }

    pub fn transact<'info>(
        ctx: Context<'info, Transact<'info>>,
        groth16_proof: Vec<u8>,
        public_witness: Vec<u8>,
        light: LightData,
        memo: Vec<u8>,
    ) -> Result<()> {
        require!(public_witness.len() == PW_HEADER + NR_INPUTS * 32, PoolError::BadWitness);
        require!(memo.len() <= MAX_MEMO, PoolError::MemoTooLong);
        let (known_root, mint, bump) = {
            let p = ctx.accounts.pool.load()?;
            (p.is_known_root(&input(&public_witness, IN_ROOT)), p.mint, p.bump)
        };
        // Contrôles bon marché d'abord.
        require_keys_eq!(token_account(&ctx.accounts.recipient_token)?.0, mint, PoolError::BadTokenAccount);
        require_keys_eq!(token_account(&ctx.accounts.relayer_token)?.0, mint, PoolError::BadTokenAccount);
        require!(known_root, PoolError::UnknownRoot);
        require!(input(&public_witness, IN_RECIPIENT) == pubkey_to_field(&ctx.accounts.recipient_token.key()), PoolError::RecipientMismatch);
        require!(input(&public_witness, IN_RELAYER) == pubkey_to_field(&ctx.accounts.relayer_token.key()), PoolError::RelayerMismatch);
        let withdraw = u64_input(&public_witness, IN_WITHDRAW)?;
        let fee = u64_input(&public_witness, IN_FEE)?;
        let outs = [input(&public_witness, IN_OUT0), input(&public_witness, IN_OUT0 + 1)];
        for o in outs.iter() {
            require!(*o < FIELD_MODULUS, PoolError::BadCommitment);
        }

        // Preuve join-split.
        let proof = GnarkProof::<N_COMMITMENTS>::from_bytes(&groth16_proof).map_err(|_| PoolError::InvalidProof)?;
        let witness = GnarkWitness::from_bytes(&public_witness).map_err(|_| PoolError::BadWitness)?;
        let mut verifier: GnarkVerifier<NR_INPUTS> = GnarkVerifier::new(&generated_vk::VK);
        verifier.verify(proof, witness).map_err(|_| PoolError::InvalidProof)?;

        // Deux nullificateurs compressés Light (échec si l'un existe déjà).
        let nulls = [input(&public_witness, IN_NULL0), input(&public_witness, IN_NULL0 + 1)];
        let cpi_accounts = CpiAccounts::new(
            ctx.accounts.signer.as_ref(),
            &ctx.remaining_accounts[light.system_accounts_offset as usize..],
            LIGHT_CPI_SIGNER,
        );
        let tree = light.address_tree_info.get_tree_pubkey(&cpi_accounts).map_err(|_| PoolError::AccountNotEnoughKeys)?;
        require!(tree.to_bytes() == light_sdk::constants::ADDRESS_TREE_V2, PoolError::InvalidAddressTree);
        let mut cpi = LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, light.proof);
        let mut params: Vec<NewAddressParamsAssignedPacked> = Vec::with_capacity(2);
        for (i, n) in nulls.iter().enumerate() {
            let (address, seed) = derive_address(&[NULLIFIER_PREFIX, n.as_slice()], &tree, &crate::ID);
            cpi = cpi.with_light_account(LightAccount::<NullifierAccount>::new_init(&crate::ID, Some(address), light.output_state_tree_index))?;
            params.push(light.address_tree_info.into_new_address_params_assigned_packed(seed, Some(i as u8)));
        }
        cpi.with_new_addresses(&params).invoke(cpi_accounts)?;

        // Nouvelles notes.
        let first_leaf_index = {
            let mut p = ctx.accounts.pool.load_mut()?;
            let (i0, _) = p.insert(&outs[0])?;
            p.insert(&outs[1])?;
            i0
        };

        // Paiements publics.
        let seeds: &[&[u8]] = &[b"pool", mint.as_ref(), &[bump]];
        let signer_seeds = &[seeds];
        let pool_key = ctx.accounts.pool.key();
        let vault = ctx.accounts.vault.to_account_info();
        let pool_ai = ctx.accounts.pool.to_account_info();
        if withdraw > 0 {
            invoke_signed(&transfer_ix(vault.key, ctx.accounts.recipient_token.key, &pool_key, withdraw),
                &[vault.clone(), ctx.accounts.recipient_token.to_account_info(), pool_ai.clone()], signer_seeds)?;
        }
        if fee > 0 {
            invoke_signed(&transfer_ix(vault.key, ctx.accounts.relayer_token.key, &pool_key, fee),
                &[vault.clone(), ctx.accounts.relayer_token.to_account_info(), pool_ai.clone()], signer_seeds)?;
        }
        emit!(Transacted { nullifiers: nulls, commitments: outs, first_leaf_index, withdraw, fee, memo });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: mint du jeton (graine du PDA ; le coffre doit être de ce mint).
    pub mint: UncheckedAccount<'info>,
    #[account(init, payer = payer, space = Pool::SIZE, seeds = [b"pool", mint.key().as_ref()], bump)]
    pub pool: AccountLoader<'info, Pool>,
    /// CHECK: compte de jetons vérifié dans `initialize`.
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub depositor: Signer<'info>,
    /// Contrôleur de conformité du pool : sa signature atteste que le déposant a été filtré.
    #[account(address = pool.load()?.screener @ PoolError::NotScreened)]
    pub screener: Signer<'info>,
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
pub struct Transact<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut, seeds = [b"pool", pool.load()?.mint.as_ref()], bump = pool.load()?.bump)]
    pub pool: AccountLoader<'info, Pool>,
    /// CHECK: doit être le coffre enregistré.
    #[account(mut, address = pool.load()?.vault)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: vérifié dans `transact` (mint) et lié à la preuve.
    #[account(mut)]
    pub recipient_token: UncheckedAccount<'info>,
    /// CHECK: vérifié dans `transact` (mint) et lié à la preuve.
    #[account(mut)]
    pub relayer_token: UncheckedAccount<'info>,
    /// CHECK: programme SPL Token.
    #[account(address = TOKEN_PROGRAM_ID)]
    pub token_program: UncheckedAccount<'info>,
}
