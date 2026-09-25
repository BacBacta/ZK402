# Micro-banc du coprocesseur CoFHE (Base Sepolia, 25 septembre 2026)

> Objectif : comprendre ce qui limite la latence du règlement (P3). Script :
> [`scripts/bench-cofhe.ts`](../packages/contracts/scripts/bench-cofhe.ts). Contrat :
> [`contracts/test/FheBench.sol`](../packages/contracts/contracts/test/FheBench.sol). Données brutes :
> `packages/contracts/deployments/bench-cofhe-base-sepolia*.json`.
>
> **Méthode** :
> - les calculs partent d'un **vrai chiffré** d'utilisateur ;
> - la latence est le délai entre la confirmation de la transaction et la disponibilité du
>   **dernier** résultat, obtenu par déchiffrement public. Elle inclut un surcoût fixe de 2 à 3 s
>   (requête de déchiffrement, sondage toutes les secondes) ;
> - une seule mesure par point : les ordres de grandeur sont fiables, les décimales ne le sont pas.

## Piège rencontré (et corrigé)

Les identifiants de chiffrés sont **déterministes**, calculés comme un hachage de l'opération et de
ses entrées. Une première série répétait les mêmes constantes (i mod 7) : le coprocesseur
renvoyait des résultats **déjà en cache**, d'où des mesures absurdes (20 multiplications en
0,25 s). Ces mesures sont **écartées**. Le banc utilise désormais des constantes uniques à chaque
exécution.

## Résultats valides

### Opérations chaînées (dépendantes) : coût marginal par opération

Pente entre deux longueurs de chaîne.

| Opération | 16 bits | 64 bits | Rapport |
|---|---|---|---|
| Addition (chaînes de 40 et 80) | ≈ 0,085 s | ≈ 0,124 s | ×1,5 |
| Multiplication (chaînes de 10 et 20) | ≈ 0,13 s | **≈ 0,62 s** | **×4,8** |
| Motif du règlement : gte + sub + select (chaînes de 40 et 60 itérations) | ≈ 0,25 s par itération | ≈ 0,25 s par itération | ≈ ×1 (le surcoût initial diffère) |

### Opérations indépendantes dans une même transaction (opérandes distincts)

| k | 16 bits : multiplication | 64 bits : multiplication | 16 bits : addition | 64 bits : addition |
|---|---|---|---|---|
| 5 | 1,9 s | 4,0 s | — | — |
| 10 | — | — | 1,5 s | 4,0 s |
| 20 | 2,1 s | **19,5 s** | — | — |
| 40 | 5,7 s | **32,0 s** | — | — |
| 80 | — | — | 5,5 s | 7,1 s |

## Conclusions

1. **La multiplication 64 bits est LE goulot** : ≈ **1 multiplication par seconde**, **non
   parallélisée** même quand les opérations sont indépendantes (20 → 19,5 s ; 40 → 32 s). En
   16 bits, ≈ 8 fois plus de débit.
2. **Cela explique entièrement la latence du pool** : 2 multiplications 64 bits par ordre
   (couverture `q × prix` et coût `exécution × prix`). Pour 32 ordres : 64 multiplications ≈ 60 s,
   à comparer aux 55 s mesurées après règlement. Les additions et comparaisons pèsent peu.
3. **Le scan parallèle n'attaque pas le vrai goulot**, d'où son gain modeste (−12 à −21 %).
4. **Levier décisif** : retirer les multiplications du chemin critique :
   - **couverture** : consignation au prix plafond **à la soumission**, pendant que le lot est
     ouvert ;
   - **coût** : calcul **différé**, puisqu'il n'est pas nécessaire pour lire son exécution.

   Le chemin critique ne contient alors plus que des additions, soustractions, comparaisons et
   sélections. Estimation : 32 ordres ≈ 10 à 15 s ; 64 ordres ≈ 20 à 30 s.
5. **Contrainte de débit global** : si le coprocesseur ne traite qu'environ 1 multiplication 64 bits
   par seconde **pour tout le monde**, la capacité est plafonnée à environ 1 800 ordres par heure
   (2 multiplications par ordre), où qu'elles soient faites. En 16 ou 32 bits, ce plafond monte.
   **Question clé pour Fhenix.**
6. **Autre contrainte découverte** : Base Sepolia refuse les transactions au-delà d'environ
   **16,7 M de gas** (2²⁴, EIP-7825). Le règlement doit rester découpé en étapes.
