// Circuit JOIN-SPLIT 2 -> 2 du pool blinde Solana (montants libres, rendu de monnaie).
//
// Note : C = H(H(pk, blinding), montant), ou pk = H(sk, 0) est la cle publique du proprietaire
// et sk sa cle de depense secrete ; nullificateur = H(nk, C) avec nk = H(sk, 1).
// - Seul le detenteur de sk peut depenser (il faut sk tel que H(sk, 0) = pk).
// - nk est une cle de CONSULTATION : un auditeur qui la recoit peut reconnaitre les notes
//   depensees (nullificateurs) sans pouvoir depenser (il lui manque sk).
// - L'emetteur d'une note pour autrui ne connait ni sk ni nk : il ne peut ni la depenser ni
//   savoir quand elle est depensee.
// Enonce prouve :
//  - chaque entree de montant > 0 est une feuille de l'arbre de racine `root` ;
//    une entree de montant 0 est fictive (pas de controle d'appartenance) ;
//  - nullifiers[k] = H(H(sk_k, 1), C_k) et les deux nullificateurs sont distincts ;
//  - out_commitments[k] = H(out_inner_k, out_amount_k) avec out_inner = H(pk_destinataire,
//    blinding) calcule hors circuit par l'emetteur ;
//  - conservation : somme(entrees) = somme(sorties) + withdraw + fee ;
//  - tous les montants sont des u64 (pas de montant negatif ni de debordement : au plus
//    2 * 2^64 de chaque cote, tres loin du module du corps) ;
//  - recipient, relayer et fee sont lies a la preuve par une vraie contrainte (en Groth16, une
//    entree publique qui n'apparait dans aucune contrainte n'est pas liee).
use poseidon::poseidon::bn254::hash_2;

global DEPTH: u32 = 20;

fn main(
    in_sk: [Field; 2],
    in_blinding: [Field; 2],
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
        let pk = hash_2([in_sk[k], 0]);
        let c = hash_2([hash_2([pk, in_blinding[k]]), in_amount[k] as Field]);
        let mut node = c;
        for i in 0..DEPTH {
            let (l, r) = if in_bits[k][i] { (in_path[k][i], node) } else { (node, in_path[k][i]) };
            node = hash_2([l, r]);
        }
        if in_amount[k] != 0 {
            assert(node == root, "note absente de l'arbre");
        }
        assert(nullifiers[k] == hash_2([hash_2([in_sk[k], 1]), c]), "nullificateur incorrect");
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

fn note(sk: Field, blinding: Field, amount: Field) -> Field {
    hash_2([hash_2([hash_2([sk, 0]), blinding]), amount])
}

fn nul(sk: Field, c: Field) -> Field {
    hash_2([hash_2([sk, 1]), c])
}

fn single_leaf_root(c: Field) -> ([Field; DEPTH], Field) {
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
    (path, node)
}

#[test]
fn test_split_and_dummy() {
    let c = note(11, 22, 1000);
    let (path, root) = single_leaf_root(c);
    let dc = note(99, 1, 0);
    main([11, 99], [22, 1], [1000, 0], [path, path], [[false; DEPTH], [false; DEPTH]], [5, 6], [700, 0],
        root, [nul(11, c), nul(99, dc)], [hash_2([5, 700]), hash_2([6, 0])], 280, 20, 0xabc, 0xdef);
}

#[test(should_fail_with = "montants non conserves")]
fn test_inflation_rejected() {
    let c = note(11, 22, 1000);
    let (path, root) = single_leaf_root(c);
    let dc = note(99, 1, 0);
    main([11, 99], [22, 1], [1000, 0], [path, path], [[false; DEPTH], [false; DEPTH]], [5, 6], [900, 0],
        root, [nul(11, c), nul(99, dc)], [hash_2([5, 900]), hash_2([6, 0])], 280, 20, 0xabc, 0xdef);
}

#[test(should_fail_with = "note absente de l'arbre")]
fn test_fake_note_rejected() {
    let c = note(11, 22, 1000);
    let path = [0; DEPTH];
    let dc = note(99, 1, 0);
    main([11, 99], [22, 1], [1000, 0], [path, path], [[false; DEPTH], [false; DEPTH]], [5, 6], [980, 0],
        12345, [nul(11, c), nul(99, dc)], [hash_2([5, 980]), hash_2([6, 0])], 0, 20, 0xabc, 0xdef);
}

// L'emetteur d'une note pour Bob connait pk_Bob, blinding et le montant, mais pas sk_Bob :
// avec une autre cle, la note recalculee n'est pas celle de l'arbre.
#[test(should_fail_with = "note absente de l'arbre")]
fn test_sender_cannot_spend_recipient_note() {
    let bob_sk = 777;
    let c = note(bob_sk, 22, 1000);
    let (path, root) = single_leaf_root(c);
    let alice_sk = 11;
    let forged = note(alice_sk, 22, 1000);
    let dc = note(99, 1, 0);
    main([alice_sk, 99], [22, 1], [1000, 0], [path, path], [[false; DEPTH], [false; DEPTH]], [5, 6], [980, 0],
        root, [nul(alice_sk, forged), nul(99, dc)], [hash_2([5, 980]), hash_2([6, 0])], 0, 20, 0xabc, 0xdef);
}

// Un auditeur qui detient la cle de consultation nk = H(sk, 1) ne peut pas depenser : utiliser
// nk comme cle de depense donne une autre cle publique, donc une note absente de l'arbre.
#[test(should_fail_with = "note absente de l'arbre")]
fn test_viewing_key_cannot_spend() {
    let sk = 777;
    let c = note(sk, 22, 1000);
    let (path, root) = single_leaf_root(c);
    let nk = hash_2([sk, 1]);
    let dc = note(99, 1, 0);
    main([nk, 99], [22, 1], [1000, 0], [path, path], [[false; DEPTH], [false; DEPTH]], [5, 6], [980, 0],
        root, [hash_2([nk, c]), nul(99, dc)], [hash_2([5, 980]), hash_2([6, 0])], 0, 20, 0xabc, 0xdef);
}
