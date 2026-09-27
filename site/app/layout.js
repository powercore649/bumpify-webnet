import Link from 'next/link';
import './globals.css';

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>
        <header className="header">
          <div className="container header-inner">
            <Link href="/" className="logo">
              <span className="moon">🌙</span> Bumpify
            </Link>
            <nav className="nav">
              <Link href="/commands">Commandes</Link>
              <Link href="/docs">Documentation</Link>
              <Link href="/docs/faq">FAQ</Link>
            </nav>
            <a
              className="btn btn-primary btn-sm"
              href="https://discord.com/oauth2/authorize?client_id=1553442824765181962&permissions=8&scope=bot%20applications.commands"
              target="_blank"
              rel="noopener noreferrer"
            >
              Ajouter le bot
            </a>
          </div>
        </header>
        <main>{children}</main>
        <footer className="footer">
          <div className="container footer-inner">
            <span>© {new Date().getFullYear()} Bumpify — Bot de bump inter-serveurs</span>
            <span>
              <a href="https://discord.gg/ts5mh326ew" target="_blank" rel="noopener noreferrer">Support</a>
              <a href="/commands">Commandes</a>
              <a href="/docs">Docs</a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
