'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import commands from '../../data/commands.json';

function isAdmin(perms) {
  // MANAGE_GUILD (1<<5=32), ADMINISTRATOR (1<<3=8), MODERATE_MEMBERS etc. — approx large
  return perms != null && perms !== '0';
}

export default function CommandsClient() {
  const params = useSearchParams();
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState(params.get('cat') || 'all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return commands.categories
      .filter(c => cat === 'all' || c.key === cat)
      .map(c => ({
        ...c,
        commands: c.commands.filter(cmd =>
          !q ||
          cmd.name.toLowerCase().includes(q) ||
          cmd.description.toLowerCase().includes(q) ||
          cmd.subcommands.some(s => s.name.toLowerCase().includes(q))
        ),
      }))
      .filter(c => c.commands.length > 0);
  }, [query, cat]);

  const total = filtered.reduce((n, c) => n + c.commands.length, 0);

  return (
    <div className="container" style={{ paddingBottom: 80 }}>
      <div className="page-head">
        <h1>Commandes</h1>
        <p>Les {commands.total} commandes réelles de Bumpify, générées directement depuis le code du bot.</p>
      </div>

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Rechercher une commande… (ex : bump, warn, giveaway)"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      <div className="pills">
        <button className={`pill ${cat === 'all' ? 'active' : ''}`} onClick={() => setCat('all')}>
          🌐 Toutes <span className="count">({commands.total})</span>
        </button>
        {commands.categories.map(c => (
          <button
            key={c.key}
            className={`pill ${cat === c.key ? 'active' : ''}`}
            onClick={() => setCat(c.key)}
          >
            {c.emoji} {c.label} <span className="count">({c.count})</span>
          </button>
        ))}
      </div>

      {total === 0 && (
        <div className="no-result">
          Aucune commande ne correspond à « {query} » 🤔
        </div>
      )}

      <div style={{ display: 'grid', gap: 28 }}>
        {filtered.map(category => (
          <section key={category.key}>
            <h2 style={{ fontSize: 20, marginBottom: 12 }}>
              {category.emoji} {category.label}
              <span style={{ color: 'var(--text-muted)', fontSize: 14, fontWeight: 500, marginLeft: 8 }}>
                {category.desc}
              </span>
            </h2>
            <div className="cmd-list">
              {category.commands.map(cmd => (
                <details className="cmd" key={cmd.name}>
                  <summary>
                    <span className="chev">▶</span>
                    <span className="name">/{cmd.name}</span>
                    <span className="desc">{cmd.description}</span>
                    {cmd.file?.includes('/owner/') || category.key === 'owner' ? (
                      <span className="badge badge-owner">Owner</span>
                    ) : cmd.defaultMemberPermissions ? (
                      <span className="badge badge-admin">Admin</span>
                    ) : null}
                  </summary>
                  <div className="cmd-body">
                    {cmd.subcommands.length > 0 && (
                      <div className="sub-list">
                        {cmd.subcommands.map(sub => (
                          <div className="sub" key={sub.name}>
                            <div className="sub-name">/{cmd.name} {sub.name}</div>
                            <div className="sub-desc">{sub.description}</div>
                            {sub.options.map(o => (
                              <div className="opt" key={o.name}>
                                <code>{o.name}</code>
                                <span className="opt-desc">{o.description}</span>
                                {o.required ? <span className="req">requis</span> : null}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                    {cmd.options.length > 0 && (
                      <div className="sub-list" style={{ marginTop: cmd.subcommands.length ? 10 : 0 }}>
                        {cmd.options.map(o => (
                          <div className="opt" key={o.name}>
                            <code>{o.name}</code>
                            <span className="opt-desc">{o.description}</span>
                            {o.required ? <span className="req">requis</span> : null}
                          </div>
                        ))}
                      </div>
                    )}
                    {cmd.subcommands.length === 0 && cmd.options.length === 0 && (
                      <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>Aucune option — utilisez-la telle quelle.</p>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
