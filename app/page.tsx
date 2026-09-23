'use client'

import Link from 'next/link'

const sample = {
  mint: '7Ytr8cNwQk4vXjJmK2Px',
  puller: '7dYw...fK2q',
  amount: '12.40 SOL',
  usd: '$1,840',
  sentTo: '9xD2...qP8L',
}

export default function LandingPage() {
  return (
    <main className="landing-page">
      <header className="landing-nav">
        <Link className="wordmark" href="/">DRAIN</Link>
        <nav><a href="#how-it-works">How it works</a><Link href="/board">Open the board</Link></nav>
      </header>

      <section className="hero landing-container">
        <p className="eyebrow">liquidity removes only</p>
        <h1>See who <em>emptied</em> the pool.</h1>
        <p className="hero-copy">Live liquidity pool removals on Solana. Who pulled the LP, how much, whether they already sent the SOL on.</p>
        <Link className="button-primary" href="/board">Open the board</Link>
      </section>

      <section id="how-it-works" className="steps landing-container">
        <div className="section-heading"><span>How it works</span><span className="mono">01—03</span></div>
        <div className="steps-grid">
          <Step number="01" title="Stream LP removes">Listen for liquidity pool removals only.</Step>
          <Step number="02" title="Show the puller and the amount">Wallet that pulled, and how much SOL came out.</Step>
          <Step number="03" title="Watch that wallet for an outbound transfer">If they send the SOL on, show the destination wallet.</Step>
        </div>
      </section>

      <section className="sample-wrap landing-container">
        <div className="section-heading"><span>Sample event</span><span className="mono">live example</span></div>
        <article className="sample-card">
          <div className="sample-top"><span className="mono muted">raydium / liquidity remove</span><span className="status-live"><i />LIVE</span></div>
          <div className="sample-grid">
            <div><span className="label">mint</span><strong className="mono address">{sample.mint}</strong></div>
            <div><span className="label">sol out</span><strong className="orange amount-large">{sample.amount}</strong><span className="muted mono">{sample.usd}</span></div>
            <div><span className="label">by</span><span className="mono address">{sample.puller}</span></div>
            <div><span className="label">sent on</span><strong className="mono sent-yes">yes → {sample.sentTo}</strong></div>
          </div>
          <div className="sample-footer"><span className="mono muted">slot 37218401</span><span className="sample-links"><span>solscan</span><span>chart</span></span></div>
        </article>
      </section>
      <footer className="landing-footer landing-container"><span>DRAIN</span><span className="mono">liquidity removes only</span></footer>
    </main>
  )
}

function Step({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <article className="step"><span className="step-number mono">{number}</span><h2>{title}</h2><p>{children}</p></article>
}

export {}
