// Génère la clé de vérification Groth16 (gnark) à partir de claim.vk, comme verifier-bin de Sunspot.
fn main() {
    println!("cargo:rerun-if-changed=claim.vk");
    gnark_verifier_solana::generate_key_file("claim.vk", "src/generated_vk.rs")
        .expect("clé de vérification");
}
