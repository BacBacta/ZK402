// Circuit de RECLAMATION ANONYME d'une note du pool blinde (S1, increment 3, P1).
//
// Enonce prouve (sans rien reveler d'autre) :
//   " Je connais (nk, secret) tels que la note C = H(nk, secret) est une feuille de l'arbre de
//     Merkle de racine `root`, et nullifier = H(nk, nk). "
// Les entrees publiques `recipient`, `relayer` et `fee` sont LIEES a la preuve : un tiers qui
// intercepte la transaction ne peut pas detourner la reclamation vers un autre destinataire.
//
// H = Poseidon BN254 compatible circomlib (verifiable en Solidity par PoseidonT3).
use poseidon::poseidon::bn254::hash_2;

global DEPTH: u32 = 20;

fn main(
    // --- prive
    nk: Field,
    secret: Field,
    path: [Field; DEPTH],
    index_bits: [bool; DEPTH],
    // --- public
    root: pub Field,
    nullifier: pub Field,
    recipient: pub Field,
    relayer: pub Field,
    fee: pub Field,
) {
    let leaf = hash_2([nk, secret]);
    let mut node = leaf;
    for i in 0..DEPTH {
        let (l, r) = if !index_bits[i] { (node, path[i]) } else { (path[i], node) };
        node = hash_2([l, r]);
    }
    assert(node == root, "note absente de l'arbre");
    assert(nullifier == hash_2([nk, nk]), "nullificateur incorrect");
    // Lie les parametres de destination a la preuve (anti-detournement).
    // En Groth16, une entree publique qui n'apparait dans AUCUNE contrainte n'est pas liee
    // (son terme dans la cle de verification est nul) : une egalite tautologique comme
    // `x == x` est supprimee par le compilateur et ne suffit pas (faille constatee sur
    // Solana). On impose donc une vraie contrainte qui fait intervenir les trois valeurs.
    let binding = hash_2([hash_2([recipient, relayer]), fee]);
    assert(binding != 0, "liaison invalide");
}

#[test]
fn test_claim_depth20() {
    let nk = 11;
    let secret = 22;
    let mut path = [0; DEPTH];
    // zeros de l'arbre : z0 = 0, z_{i+1} = H(z_i, z_i)
    let mut z = 0;
    for i in 0..DEPTH {
        path[i] = z;
        z = hash_2([z, z]);
    }
    let bits = [false; DEPTH];
    let mut node = hash_2([nk, secret]);
    for i in 0..DEPTH {
        node = hash_2([node, path[i]]);
    }
    main(nk, secret, path, bits, node, hash_2([nk, nk]), 0xabc, 0xdef, 1);
}

#[test]
fn test_poseidon_circomlib_vector() {
    // Vecteur de reference circomlib : Poseidon(1, 2)
    assert(hash_2([1, 2]) == 0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a);
}
