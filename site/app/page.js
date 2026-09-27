import Link from 'next/link';
import commands from '../data/commands.json';

const FEATURES = [
  { icon: '🚀', title: 'Réseau inter-serveurs', desc: 'Chaque bump diffuse votre serveur dans le salon feed de tous les serveurs connectés. Cooldown de 2h, récompenses en coins.' },
  { icon: '🛡️', title: 'Protection complète', desc: 'Captcha à l\'arrivée, anti-spam, anti-liens, anti-raid, honeypot, anti-arnaque par image — votre serveur reste sain.' },
  { icon: '🏆', title: 'XP & niveaux', desc: 'Cartes de rang en canvas, récompenses par niveau, classements configurables et auto-postés.' },
  { icon: '💰', title: 'Économie vivante', desc: 'Coins quotidiens, travail, pêche, boutique de serveur, duels animés — vos membres restent actifs.' },
  { icon: '📺', title: 'Alertes Twitch & YouTube', desc: 'Annonces automatiques quand vos streamers passent en live ou publient une nouvelle vidéo.' },
  { icon: '🤖', title: 'IA intégrée', desc: 'Chat IA dans un salon dédié, génération d\'images, quotas configurables — propulsé par Gemini.' },
];

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="container">
          <div className="hero-badge">🌙 Bumpify — Réseau inter-serveurs</div>
          <h1>
            Faites décoller <span className="grad">votre serveur</span><br />avec un seul commande.
          </h1>
          <p className="lead">
            Bumpify connecte votre communauté à un réseau de serveurs : bumps, XP,
            économie, modération avancée, alertes streams et IA — tout dans un seul bot, gratuit.
          </p>
          <div className="hero-actions">
            <a
              className="btn btn-primary"
              href="https://discord.com/oauth2/authorize?client_id=1553823703903641771&permissions=8&scope=bot%20applications.commands"
              target="_blank"
              rel="noopener noreferrer"
            >
              Inviter Bumpify
            </a>
            <Link className="btn btn-ghost" href="/commands">Voir les {commands.total} commandes</Link>
          </div>
        </div>
      </section>

      <div className="container">
        <div className="stats">
          <div className="stat"><div className="value">{commands.total}</div><div className="label">Commandes</div></div>
          <div className="stat"><div className="value">{commands.categories.length}</div><div className="label">Catégories</div></div>
          <div className="stat"><div className="value">24/7</div><div className="label">En ligne</div></div>
          <div className="stat"><div className="value">2h</div><div className="label">Cooldown bump</div></div>
        </div>
      </div>

      <section className="section">
        <div className="container">
          <h2 className="section-title">Tout-en-un, sans compromis</h2>
          <p className="section-sub">
            Un bot unique qui remplace une dizaine d'autres — chaque module est configurable depuis un panneau.
          </p>
          <div className="grid-3">
            {FEATURES.map(f => (
              <div className="feature" key={f.title}>
                <div className="icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="container">
          <h2 className="section-title">Catégories de commandes</h2>
          <p className="section-sub">Chaque catégorie couvre un besoin précis de votre serveur.</p>
          <div className="doc-cards">
            {commands.categories.map(cat => (
              <Link className="doc-card" href={`/commands?cat=${cat.key}`} key={cat.key}>
                <div className="emoji">{cat.emoji}</div>
                <h3>{cat.label} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>· {cat.count}</span></h3>
                <p>{cat.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="container">
        <div className="cta">
          <h2>Prêt à rejoindre le réseau ?</h2>
          <p>Ajoutez Bumpify, configurez-le en 2 minutes avec /config, et lancez votre premier bump.</p>
          <a
            className="btn btn-primary"
            href="https://discord.com/oauth2/authorize?client_id=1553823703903641771&permissions=8&scope=bot%20applications.commands"
            target="_blank"
            rel="noopener noreferrer"
          >
            Inviter maintenant
          </a>
        </div>
      </section>
    </>
  );
}
