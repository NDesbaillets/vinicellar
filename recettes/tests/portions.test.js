// Test des règles d'arrondi des portions (contrat §5). Lancer : node recettes/tests/portions.test.js
const assert = require("assert");
const { scaleQty, portionFactor, fmtHalf } = require("../assets/recettes.js");
let n = 0, fails = 0;
const t = (nom, q, u, f, attendu, prec) => {
  n++;
  const r = scaleQty(q, u, prec == null ? null : prec, f).text;
  if (r !== attendu) { fails++; console.log(`ECHEC ${nom} : ${q} ${u} x ${f} -> « ${r} » (attendu « ${attendu} »)`); }
};
const F = portionFactor(6, 4); // 4 -> 6 portions
assert.strictEqual(F, 1.5);
assert.strictEqual(portionFactor(6, null), 1);
// pièces
t("oeufs 3", 3, "piece", F, "5 pièces");        // 4,5 -> 5
t("oeufs 2", 2, "piece", F, "3 pièces");
t("oeuf 1", 1, "piece", F, "2 pièces");          // 1,5 -> 2
t("oeuf min 1", 1, "piece", 0.25, "1 pièce");    // jamais 0
t("oeuf 0,4", 1, "piece", 0.4, "1 pièce");
t("oeufs 5x0,3", 5, "piece", 0.3, "2 pièces");   // 1,5 -> 2
t("oeufs 3x0,5", 3, "piece", 0.5, "2 pièces");   // 1,5 -> 2
t("oeufs 7x0,5", 7, "piece", 0.5, "4 pièces");   // 3,5 -> 4
t("oeufs 6x0,4", 6, "piece", 0.4, "2 pièces");   // 2,4 -> 2
// gousses, bottes, tranches
t("gousses 1", 1, "gousse", F, "2 gousses");
t("gousses 3", 3, "gousse", F, "5 gousses");
t("botte 1", 1, "botte", 2, "2 bottes");
t("tranches 3", 3, "tranche", 0.5, "2 tranches");
// pincée et q.b. : inchangés
t("pincée", 1, "pincee", F, "1 pincée");
t("pincée x4", 1, "pincee", 4, "1 pincée");
t("q.b. vide", null, null, F, "q.b.");
t("q.b. précision", null, null, F, "à volonté", "à volonté");
t("q.b. avec qté : inchangée", 2, "g", F, "2 g", "q.b.");
// cuillères
t("càs 1", 1, "cas", F, "1 ½ c. à soupe");
t("càs 2", 2, "cas", F, "3 c. à soupe");
t("càs 0,5", 0.5, "cas", F, "1 c. à soupe");        // 0,75 -> 1
t("càf pointe", 0.25, "cac", 0.5, "une pointe");  // 0,125 < 0,25
t("càf 0,5x0,5", 0.5, "cac", 0.5, "½ c. à café"); // 0,25 -> 0,5
t("càs 3", 3, "cas", F, "4 ½ c. à soupe");
// g / ml
t("g 200", 200, "g", F, "300 g");
t("g 250", 250, "g", F, "380 g");                 // 375 -> 380
t("g 75", 75, "g", F, "110 g");                   // 112,5 -> 110
t("g 30", 30, "g", F, "45 g");
t("g 33", 33, "g", F, "50 g");                    // 49,5 -> 50
t("g 15", 15, "g", F, "25 g");                    // 22,5 -> 25 (arrondi à 5, moitié vers le haut)
t("g 99 -> 100", 66, "g", F, "100 g");            // 99 -> 100 (arrondi à 5)
t("g 800 -> kg", 800, "g", F, "1,2 kg");          // 1200 g
t("g 1000", 1000, "g", F, "1,5 kg");
t("g 100", 100, "g", 0.5, "50 g");
t("ml 250", 250, "ml", F, "380 ml");
t("ml 1000 -> l", 700, "ml", 2, "1,4 l");
t("ml 40", 40, "ml", F, "60 ml");
// cl
t("cl 10 -> 15 cl", 10, "cl", F, "15 cl");        // 150 ml, multiple de 10
t("cl 5 -> 75 ml", 5, "cl", F, "75 ml");          // 75 ml
t("cl 20 -> 30", 20, "cl", F, "30 cl");
t("cl -> l", 50, "cl", 2, "1 l");                 // 1000 ml
// kg / l
t("kg 1", 1, "kg", F, "1,5 kg");
t("kg 0,3 -> 450 g", 0.3, "kg", F, "450 g");      // 0,45 kg
t("kg 0,3x1", 0.3, "kg", 1, "0,3 kg");            // facteur 1 : inchangé
t("kg 2", 2, "kg", F, "3 kg");
t("kg 1,25", 1.25, "kg", F, "1,9 kg");            // 1,875 -> 1,9
t("l 0,5 -> 750 ml", 0.5, "l", F, "750 ml");
t("l 0,2 -> 300 ml", 0.2, "l", F, "300 ml");
t("l 0,02 -> 30 ml", 0.02, "l", F, "30 ml");      // 0,03 l = 30 ml
t("l 1,5", 1.5, "l", 2, "3 l");
// facteur 1 : valeur d'origine telle quelle
t("f=1 g", 125, "g", 1, "125 g");
t("f=1 piece", 3, "piece", 1, "3 pièces");
t("f=1 cas 0,5", 0.5, "cas", 1, "0,5 c. à soupe");
t("f=1 virgule", 1.5, "kg", 1, "1,5 kg");
// sans unité
t("sans unité 3", 3, null, F, "5");
t("sans unité 1", 1, null, 0.2, "1");
assert.strictEqual(fmtHalf(2.5), "2 ½");
assert.strictEqual(fmtHalf(0.5), "½");
// pas d'arrondis en cascade : le résultat dépend uniquement de la quantité d'origine
assert.strictEqual(scaleQty(250, "g", null, 1.5).text, scaleQty(250, "g", null, 1.5).text);
assert.strictEqual(scaleQty(3, "piece", null, 1.5).text, "5 pièces");
assert.strictEqual(scaleQty(3, "piece", null, 1).text, "3 pièces");
console.log(`${n} cas, ${fails} échec(s)`);
process.exit(fails ? 1 : 0);
