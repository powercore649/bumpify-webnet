const { createWorker } = require('tesseract.js');
const axios = require('axios');

// ═══════════════════════════════════════════════════════════════════════════
// Moteur anti-arnaque : OCR (Tesseract, local, gratuit) + règles de détection.
// Aucune IA générative n'est utilisée ici — chaque facteur détecté correspond
// à une correspondance de texte réelle et vérifiable, jamais une supposition.
// L'image elle-même n'est jamais conservée : seul le texte extrait est traité
// en mémoire pendant l'analyse.
// ═══════════════════════════════════════════════════════════════════════════

let worker = null;
async function getWorker() {
  if (!worker) {
    try {
      worker = await createWorker('eng+fra');
    } catch (err) {
      worker = null;
      throw err;
    }
  }
  return worker;
}

// Chaque catégorie a un poids : la somme des poids des correspondances trouvées
// donne l'indice de suspicion (plafonné à 100), exactement comme "Indice de
// suspicion" dans les alertes.
const RULES = {
  crypto: {
    weight: 25,
    label: 'Contenu lié aux cryptomonnaies / giveaways',
    patterns: [
      /\bcrypto(currency)?\b/i,
      /\b(bitcoin|btc|ethereum|eth|usdt|binance|metamask|trust\s*wallet)\b/i,
      /\b(giveaway|giving\s*away|airdrop|free\s*mint|claim\s*now)\b/i,
    ],
  },
  fakeNitro: {
    weight: 25,
    label: 'Contenu lié à de faux cadeaux (Nitro/Robux)',
    patterns: [
      /\b(free\s*nitro|nitro\s*gift|discord\s*nitro\s*free)\b/i,
      /\b(free\s*robux|robux\s*generator)\b/i,
      /\b(steam\s*gift|free\s*vbucks|v-?bucks\s*free)\b/i,
    ],
  },
  urgency: {
    weight: 15,
    label: "Incitation à l'action / sentiment d'urgence",
    patterns: [
      /\b(hurry|limited\s*time|expires?\s*(soon|today)|only\s*\d+\s*(left|spots)|act\s*(now|fast)|immediately|dernière?\s*chance|offre\s*limitée|dépêch)/i,
      /delet(e|ed)\s*(in|after)?\s*(an?\s*)?hour|only\s*(the\s*)?fastest\s*(people|will)/i,
    ],
  },
  impersonation: {
    weight: 20,
    label: "Usurpation d'identité de marque ou célébrité détectée",
    patterns: [
      /\b(discord\s*staff|discord\s*partner|discord\s*official|official\s*discord)\b/i,
      /\b(elon\s*musk|tesla\s*giveaway|binance\s*official)\b/i,
      /\b(steam\s*support|valve\s*official)\b/i,
      /\b(mrbeast|mr\.?\s*beast|pewdiepie|kardashian)\b/i,
    ],
  },
  financial: {
    weight: 15,
    label: 'Indication de retrait financier ou transfert suspect',
    patterns: [
      /\b(send\s*\$?\d|deposit|withdraw(al)?|transfer\s*now|wallet\s*address|virement|retrait\s*disponible)\b/i,
      /\bwithdrawal\s*success|your\s*withdrawal\s*of|was\s*(successfully\s*)?transferred/i,
      /0x[a-fA-F0-9]{16,}/, // motif d'adresse de portefeuille crypto
    ],
  },
};

const CATEGORY_TO_CONFIG_FLAG = {
  crypto: 'detectCrypto',
  fakeNitro: 'detectCrypto',
  urgency: 'detectUrgency',
  impersonation: 'detectImpersonation',
  financial: 'detectFinancial',
};

// Extrait le texte d'une image (URL Discord CDN) via OCR local.
// On télécharge d'abord l'image nous-mêmes (axios) plutôt que de laisser
// Tesseract récupérer l'URL directement : c'est nettement plus fiable face
// aux formats WebP et aux en-têtes du CDN Discord.
async function extractText(imageUrl) {
  const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 15000 });
  const buffer = Buffer.from(response.data);

  try {
    const w = await getWorker();
    const { data } = await w.recognize(buffer);
    return data.text || '';
  } catch (err) {
    // Un worker dans un état corrompu échouerait sur TOUS les scans suivants :
    // on le jette pour forcer sa recréation propre au prochain appel.
    if (worker) {
      await worker.terminate().catch(() => {});
      worker = null;
    }
    throw err;
  }
}

// Analyse le texte extrait selon les catégories activées + mots-clés perso.
// Renvoie { score, factors: [label...] } — jamais de facteur sans correspondance réelle.
function analyzeText(text, config) {
  const factors = [];
  let score = 0;

  for (const [key, rule] of Object.entries(RULES)) {
    const flag = CATEGORY_TO_CONFIG_FLAG[key];
    if (config[flag] === false) continue;
    const matched = rule.patterns.some((re) => re.test(text));
    if (matched) {
      factors.push(rule.label);
      score += rule.weight;
    }
  }

  for (const kw of config.customKeywords || []) {
    if (kw && text.toLowerCase().includes(kw.toLowerCase())) {
      factors.push(`Mot-clé personnalisé détecté : "${kw}"`);
      score += 10;
    }
  }

  // Convergence de plusieurs vecteurs = signal fort à part entière (comme dans les captures)
  if (factors.length >= 3) {
    factors.push('Convergence de plusieurs vecteurs de menace dans l\'image');
    score += 15;
  }

  return { score: Math.min(100, score), factors };
}

// Point d'entrée utilisé par l'event de scan de messages.
async function scanImage(imageUrl, config) {
  const text = await extractText(imageUrl);
  const { score, factors } = analyzeText(text, config);
  return { score, factors, extractedText: text.slice(0, 500) };
}

module.exports = { scanImage, analyzeText, extractText };
