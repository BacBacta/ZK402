// Circuit JOIN-SPLIT 2 -> 2 du pool blinde Solana (montants libres, rendu de monnaie).
//
// Note : C = H(H(nk, secret), montant) ; nullificateur = H(nk, C).
// Enonce prouve :
//  - chaque entree de montant > 0 est une feuille de l'arbre de racine `root` ;
//    une entree de montant 0 est fictive (pas de controle d'appartenance) ;
//  - nullifiers[k] = H(nk_k, C_k) et les deux nullificateurs sont distincts ;
//  - out_commitments[k] = H(out_inner_k, out_amount_k) (le destinataire d'une note de sortie
//    connait out_inner = H(nk', secret')) ;
//  - conservation : somme(entrees) = somme(sorties) + withdraw + fee ;
//  - tous les montants sont des u64 (pas de montant negatif ni de debordement : au plus
//    2 * 2^64 de chaque cote, tres loin du module du corps) ;
//  - recipient, relayer et fee sont lies a la preuve par une vraie contrainte (en Groth16, une
//    entree publique qui n'apparait dans aucune contrainte n'est pas liee).
use poseidon::poseidon::bn254::hash_2;

global DEPTH: u32 = 20;

fn main(
    in_nk: [Field; 2],
    in_secret: [Field; 2],
    in_amount: [u64; 2],
    in_path: [[Field; DEPTH]; 2],
    in_bits: [[bool; DEPTH]; 2],
    out_inner: [Field; 2],
    out_amount: [u64; 2],
    root: pub Field,
    nullifiers: pub [Field; 2],
    out_commitments: pub [Field; 2],
    withdraw: pub u64,
    fee: pub u64,
    recipient: pub Field,
    relayer: pub Field,
) {
    let mut sum_in: Field = 0;
    for k in 0..2 {
        let c = hash_2([hash_2([in_nk[k], in_secret[k]]), in_amount[k] as Field]);
        let mut node = c;
        for i in 0..DEPTH {
            let (l, r) = if in_bits[k][i] { (in_path[k][i], node) } else { (node, in_path[k][i]) };
            node = hash_2([l, r]);
        }
        if in_amount[k] != 0 {
            assert(node == root, "note absente de l'arbre");
        }
        assert(nullifiers[k] == hash_2([in_nk[k], c]), "nullificateur incorrect");
        sum_in += in_amount[k] as Field;
    }
    assert(nullifiers[0] != nullifiers[1], "nullificateurs identiques");

    let mut sum_out: Field = 0;
    for k in 0..2 {
        assert(out_commitments[k] == hash_2([out_inner[k], out_amount[k] as Field]), "engagement de sortie incorrect");
        sum_out += out_amount[k] as Field;
    }
    assert(sum_in == sum_out + withdraw as Field + fee as Field, "montants non conserves");

    let binding = hash_2([hash_2([recipient, relayer]), fee as Field]);
    assert(binding != 0, "liaison invalide");
}

#[test]
fn test_split_and_dummy() {
    let nk = 11;
    let secret = 22;
    let c = hash_2([hash_2([nk, secret]), 1000]);
    let mut z = 0;
    let mut path = [0; DEPTH];
    for i in 0..DEPTH {
        path[i] = z;
        z = hash_2([z, z]);
    }
    let mut node = c;
    for i in 0..DEPTH {
        node = hash_2([node, path[i]]);
    }
    let dnk = 99;
    let dc = hash_2([hash_2([dnk, 1]), 0]);
    let o0 = hash_2([5, 700]);
    let o1 = hash_2([6, 0]);
    main([nk, dnk], [secret, 1], [1000, 0], [path, path], [[false; DEPTH], [false; DEPTH]], [5, 6], [700, 0],
        node, [hash_2([nk, c]), hash_2([dnk, dc])], [o0, o1], 280, 20, 0xabc, 0xdef);
}

#[test(should_fail_with = "montants non conserves")]
fn test_inflation_rejected() {
    let nk = 11;
    let secret = 22;
    let c = hash_2([hash_2([nk, secret]), 1000]);
    let mut z = 0;
    let mut path = [0; DEPTH];
    for i in 0..DEPTH {
        path[i] = z;
        z = hash_2([z, z]);
    }
    let mut node = c;
    for i in 0..DEPTH {
        node = hash_2([node, path[i]]);
    }
    let dc = hash_2([hash_2([99, 1]), 0]);
    main([nk, 99], [secret, 1], [1000, 0], [path, path], [[false; DEPTH], [false; DEPTH]], [5, 6], [900, 0],
        node, [hash_2([nk, c]), hash_2([99, dc])], [hash_2([5, 900]), hash_2([6, 0])], 280, 20, 0xabc, 0xdef);
}

#[test(should_fail_with = "note absente de l'arbre")]
fn test_fake_note_rejected() {
    let c = hash_2([hash_2([11, 22]), 1000]);
    let path = [0; DEPTH];
    let dc = hash_2([hash_2([99, 1]), 0]);
    main([11, 99], [22, 1], [1000, 0], [path, path], [[false; DEPTH], [false; DEPTH]], [5, 6], [980, 0],
        12345, [hash_2([11, c]), hash_2([99, dc])], [hash_2([5, 980]), hash_2([6, 0])], 0, 20, 0xabc, 0xdef);
}
