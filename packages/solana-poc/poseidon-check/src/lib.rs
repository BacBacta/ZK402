//! Vérifie que le Poseidon natif de Solana (syscall sol_poseidon, BN254 x5, compatible
//! circomlib) donne les mêmes valeurs que le circuit Noir (noir-lang/poseidon) :
//! recalcule on-chain la feuille, la racine d'un chemin de Merkle de profondeur 20 et le
//! nullificateur, et les journalise. Données d'instruction :
//!   nk (32 o, BE) | secret (32) | index (u32 LE) | chemin 20 × 32 o
use solana_poseidon::{hashv, Endianness, Parameters};
use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, log::sol_log_compute_units,
    msg, program_error::ProgramError, pubkey::Pubkey,
};

entrypoint!(process_instruction);

const DEPTH: usize = 20;

fn h(a: &[u8], b: &[u8]) -> Result<[u8; 32], ProgramError> {
    hashv(Parameters::Bn254X5, Endianness::BigEndian, &[a, b])
        .map(|x| x.to_bytes())
        .map_err(|_| ProgramError::InvalidArgument)
}

fn hex(b: &[u8; 32]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

pub fn process_instruction(_p: &Pubkey, _a: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != 64 + 4 + DEPTH * 32 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let (nk, rest) = data.split_at(32);
    let (secret, rest) = rest.split_at(32);
    let (idx, path) = rest.split_at(4);
    let index = u32::from_le_bytes([idx[0], idx[1], idx[2], idx[3]]);

    let mut one = [0u8; 32];
    one[31] = 1;
    let mut two = [0u8; 32];
    two[31] = 2;
    msg!("H(1,2) = {}", hex(&h(&one, &two)?));

    sol_log_compute_units();
    let leaf = h(nk, secret)?;
    let mut node = leaf;
    for i in 0..DEPTH {
        let sib = &path[i * 32..(i + 1) * 32];
        node = if (index >> i) & 1 == 1 { h(sib, &node)? } else { h(&node, sib)? };
    }
    let nullifier = h(nk, nk)?;
    sol_log_compute_units();
    msg!("leaf = {}", hex(&leaf));
    msg!("root = {}", hex(&node));
    msg!("nullifier = {}", hex(&nullifier));
    Ok(())
}
