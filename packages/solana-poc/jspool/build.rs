// Génère la clé de vérification Groth16 (gnark) à partir de joinsplit.vk, comme verifier-bin de Sunspot.
fn main() {
    println!("cargo:rerun-if-changed=joinsplit.vk");
    gnark_verifier_solana::generate_key_file("joinsplit.vk", "src/generated_vk.rs")
        .expect("clé de vérification");
}
