'use strict';
// utils/jokesData.js — Banque de blagues v2 (catégorisée, IDs stables pour la notation)

const CATEGORIES = {
  dev:         '💻 Informatique',
  animaux:     '🐾 Animaux',
  absurde:     '🤪 Absurde',
  jeux_mots:   '🔤 Jeux de mots',
  ecole:       '🎒 École',
  nourriture:  '🍔 Nourriture',
};

const JOKES = [
  // ── 💻 Informatique ──
  { id: 'dev_01', category: 'dev', setup: 'Pourquoi les développeurs préfèrent-ils le mode sombre ?', punchline: 'Parce que la lumière attire les bugs !' },
  { id: 'dev_02', category: 'dev', setup: 'Combien faut-il de développeurs pour changer une ampoule ?', punchline: 'Aucun, c\'est un problème matériel.' },
  { id: 'dev_03', category: 'dev', setup: 'Pourquoi les programmeurs confondent-ils Halloween et Noël ?', punchline: 'Parce que OCT 31 == DEC 25 !' },
  { id: 'dev_04', category: 'dev', setup: 'Un SQL query entre dans un bar, s\'approche de deux tables et demande...', punchline: '"Je peux me joindre à vous ?"' },
  { id: 'dev_05', category: 'dev', setup: 'Pourquoi le développeur a-t-il quitté son travail ?', punchline: 'Il n\'a pas eu d\'array (de raise) !' },
  { id: 'dev_06', category: 'dev', setup: 'Qu\'est-ce qu\'un développeur dit avant de partir en vacances ?', punchline: '"git commit -m \'ça marche sur ma machine\'"' },
  { id: 'dev_07', category: 'dev', setup: 'Pourquoi les devs détestent-ils la nature ?', punchline: 'Trop de bugs et pas assez de documentation.' },
  { id: 'dev_08', category: 'dev', setup: 'Comment appelle-t-on un développeur qui ne commente jamais son code ?', punchline: 'Un ennemi de son futur lui.' },
  { id: 'dev_09', category: 'dev', setup: 'Pourquoi le code fonctionne en local mais pas en prod ?', punchline: 'Parce que la prod, c\'est le seul environnement qui ne ment pas.' },
  { id: 'dev_10', category: 'dev', setup: 'Il y a 10 types de personnes dans le monde...', punchline: 'Ceux qui comprennent le binaire, et les autres.' },

  // ── 🐾 Animaux ──
  { id: 'ani_01', category: 'animaux', setup: 'Pourquoi les plongeurs plongent-ils toujours en arrière ?', punchline: 'Parce que sinon ils tombent dans le bateau !' },
  { id: 'ani_02', category: 'animaux', setup: 'Qu\'est-ce qu\'un crocodile qui surveille la pharmacie ?', punchline: 'Un Lacoste-guard !' },
  { id: 'ani_03', category: 'animaux', setup: 'Comment appelle-t-on un chat tombé dans un pot de peinture le jour de Noël ?', punchline: 'Un chat-peint de Noël !' },
  { id: 'ani_04', category: 'animaux', setup: 'Que dit un escargot quand il croise une limace ?', punchline: '"Wow, un nudiste !"' },
  { id: 'ani_05', category: 'animaux', setup: 'Pourquoi les poissons n\'aiment pas jouer au tennis ?', punchline: 'Parce qu\'ils ont peur du filet !' },
  { id: 'ani_06', category: 'animaux', setup: 'Que fait une vache qui ne dit rien ?', punchline: 'De la viande hachée.' },
  { id: 'ani_07', category: 'animaux', setup: 'Pourquoi les abeilles ont-elles les cheveux collants ?', punchline: 'À cause du miel-gel !' },
  { id: 'ani_08', category: 'animaux', setup: 'Quel est le comble pour une girafe ?', punchline: 'D\'avoir mal aux pieds !' },
  { id: 'ani_09', category: 'animaux', setup: 'Comment appelle-t-on un chien magicien ?', punchline: 'Un labra-cadabra !' },
  { id: 'ani_10', category: 'animaux', setup: 'Pourquoi le hibou ne se marie jamais ?', punchline: 'Parce qu\'il est chouette célibataire !' },

  // ── 🤪 Absurde ──
  { id: 'abs_01', category: 'absurde', setup: 'Que se passe-t-il si on croise un mouton avec un kangourou ?', punchline: 'On obtient un pull qui saute !' },
  { id: 'abs_02', category: 'absurde', setup: 'Pourquoi les fantômes sont-ils de mauvais menteurs ?', punchline: 'On voit à travers eux !' },
  { id: 'abs_03', category: 'absurde', setup: 'Que dit un mur à un autre mur ?', punchline: '"On se retrouve au coin !"' },
  { id: 'abs_04', category: 'absurde', setup: 'Pourquoi le café a-t-il porté plainte ?', punchline: 'On l\'a agressé (expresso) !' },
  { id: 'abs_05', category: 'absurde', setup: 'Que dit une horloge quand elle a faim ?', punchline: '"Il est l\'heure de manger !"' },
  { id: 'abs_06', category: 'absurde', setup: 'Pourquoi les squelettes ne se battent-ils jamais entre eux ?', punchline: 'Ils n\'ont pas les tripes pour ça.' },
  { id: 'abs_07', category: 'absurde', setup: 'Comment un scientifique se rafraîchit-il l\'haleine ?', punchline: 'Avec des experi-menthes !' },
  { id: 'abs_08', category: 'absurde', setup: 'Pourquoi le nombre 6 a-t-il peur du 7 ?', punchline: 'Parce que 7 a mangé 9 (sept-a-neuf) !' },
  { id: 'abs_09', category: 'absurde', setup: 'Qu\'est-ce qui est jaune et qui attend ?', punchline: 'Jonathan.' },
  { id: 'abs_10', category: 'absurde', setup: 'Pourquoi les plongeurs sous-marins gardent-ils la porte ouverte ?', punchline: 'Au cas où ils changeraient d\'avis !' },

  // ── 🔤 Jeux de mots ──
  { id: 'jdm_01', category: 'jeux_mots', setup: 'Quel est le comble pour un électricien ?', punchline: 'De ne pas être au courant !' },
  { id: 'jdm_02', category: 'jeux_mots', setup: 'Quel est le sport favori des champignons ?', punchline: 'Le vélo, parce qu\'ils sont champi-gnon !' },
  { id: 'jdm_03', category: 'jeux_mots', setup: 'Que dit une imprimante à une autre imprimante ?', punchline: '"Ce papier est pour toi !"' },
  { id: 'jdm_04', category: 'jeux_mots', setup: 'Quel est le comble pour un jardinier ?', punchline: 'De semer la zizanie !' },
  { id: 'jdm_05', category: 'jeux_mots', setup: 'Pourquoi les mathématiciens confondent Noël et Halloween ?', punchline: 'Parce que les deux finissent en "-ël"... (bon ok celle-là est nulle)' },
  { id: 'jdm_06', category: 'jeux_mots', setup: 'Quel est le comble pour un marin ?', punchline: 'D\'avoir le nez qui coule !' },
  { id: 'jdm_07', category: 'jeux_mots', setup: 'Que dit un jardinier à son plant de tomates préféré ?', punchline: '"Ketchup avec toi bientôt !"' },
  { id: 'jdm_08', category: 'jeux_mots', setup: 'Quel est le comble pour un boulanger ?', punchline: 'De ne pas gagner sa croûte !' },
  { id: 'jdm_09', category: 'jeux_mots', setup: 'Que dit une pile à une autre pile ?', punchline: '"Je te trouve électrisante !"' },
  { id: 'jdm_10', category: 'jeux_mots', setup: 'Quel est le comble pour un plombier ?', punchline: 'D\'avoir un robinet qui fuit !' },

  // ── 🎒 École ──
  { id: 'eco_01', category: 'ecole', setup: 'Pourquoi le cahier est-il fatigué ?', punchline: 'Parce qu\'il a trop de lignes à suivre !' },
  { id: 'eco_02', category: 'ecole', setup: 'Quel est l\'animal le plus doué en maths ?', punchline: 'Le compte-de-fée !' },
  { id: 'eco_03', category: 'ecole', setup: 'Pourquoi la maîtresse porte-t-elle des lunettes de soleil ?', punchline: 'Parce que ses élèves sont brillants !' },
  { id: 'eco_04', category: 'ecole', setup: 'Que dit une règle à un crayon ?', punchline: '"Reste droit avec moi !"' },
  { id: 'eco_05', category: 'ecole', setup: 'Pourquoi le zéro n\'a-t-il pas d\'amis ?', punchline: 'Parce qu\'il compte pour rien !' },
  { id: 'eco_06', category: 'ecole', setup: 'Quel est le comble pour un professeur de géographie ?', punchline: 'De perdre le nord !' },

  // ── 🍔 Nourriture ──
  { id: 'foo_01', category: 'nourriture', setup: 'Que dit une pomme de terre en boîte ?', punchline: '"Chips heureuse d\'être là !"' },
  { id: 'foo_02', category: 'nourriture', setup: 'Pourquoi le petit pain est-il triste ?', punchline: 'Parce que sa mie lui manque !' },
  { id: 'foo_03', category: 'nourriture', setup: 'Quel est le fromage préféré des chevaux ?', punchline: 'Le gruyère, à cause des trous de sabot !' },
  { id: 'foo_04', category: 'nourriture', setup: 'Que dit une banane à une autre banane ?', punchline: '"On se pèle de froid !"' },
  { id: 'foo_05', category: 'nourriture', setup: 'Quel est le comble pour un boulanger fatigué ?', punchline: 'De ne plus avoir de pain dans les jambes !' },
  { id: 'foo_06', category: 'nourriture', setup: 'Pourquoi la tomate a-t-elle rougi ?', punchline: 'Parce qu\'elle a vu la salade se faire dresser !' },
];

module.exports = { JOKES, CATEGORIES };
