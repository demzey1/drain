'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PullEvent } from '@/lib/types'
import { chartUrl, shorten, solscanAccount, solscanTx } from '@/lib/links'

declare global {
  interface Window {
    __DRAIN_PUSH__?: (event: PullEvent) => void
    __DRAIN_WS__?: string
  }
}

const age = (ts: number) => {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`
}

export default function BoardPage() {
  const [events, setEvents] = useState<PullEvent[]>([])
  const [selected, setSelected] = useState<PullEvent | null>(null)
  const [paused, setPaused] = useState(false)
  const [muted, setMuted] = useState(false)
  const [live, setLive] = useState(false)
  const [copied, setCopied] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [tick, setTick] = useState(0)

  const pushEvent = useCallback((event: PullEvent) => {
    if (paused) return
    setEvents((current) => [event, ...current.filter((item) => item.id !== event.id)].slice(0, 8))
    setSelected((current) => (!current || current.id === event.id ? event : current))
  }, [paused])

  useEffect(() => {
    window.__DRAIN_PUSH__ = pushEvent
    const url = window.__DRAIN_WS__ || process.env.NEXT_PUBLIC_DRAIN_WS || 'ws://127.0.0.1:8787'
    let socket: WebSocket | null = null
    try {
      socket = new WebSocket(url)
      socket.onopen = () => setLive(true)
      socket.onclose = () => setLive(false)
      socket.onerror = () => setLive(false)
      socket.onmessage = (message) => {
        const event = JSON.parse(message.data) as PullEvent
        if (!event?.signature) return
        pushEvent(event)
      }
    } catch {
      setLive(false)
    }
    return () => {
      socket?.close()
      delete window.__DRAIN_PUSH__
    }
  }, [pushEvent])

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  const copy = async (value: string) => {
    await navigator.clipboard?.writeText(value)
    setCopied(value)
    window.setTimeout(() => setCopied(''), 900)
  }

  const current = selected ?? events[0]
  const slot = useMemo(() => events[0]?.slot ?? null, [events])
  void tick
  void muted

  return (
    <main className="board-page">
      <header className="board-header">
        <Link className="wordmark" href="/">DRAIN</Link>
        <div className="board-controls">
          <span className="status-live"><i />{live ? 'LIVE' : 'RECONNECTING'}</span>
          <span className="mono board-slot">
            {slot ? `slot ${slot}` : 'slot —'} · last pull {events[0] ? age(events[0].ts) : '—'}
          </span>
          <button onClick={() => setMuted(!muted)}>{muted ? 'unmute' : 'mute'}</button>
          <button onClick={() => setPaused(!paused)}>{paused ? 'resume' : 'pause'}</button>
        </div>
      </header>
      <div className="board-layout">
        <section className="pull-list" aria-label="Liquidity pulls">
          {events.length === 0 ? (
            <div className="board-empty">
              <strong>waiting for a pull</strong>
              <span className="mono">liquidity removes only</span>
            </div>
          ) : events.map((event) => (
            <button
              key={event.id}
              className={`pull-row ${current?.id === event.id ? 'selected' : ''}`}
              onClick={() => {
                setSelected(event)
                setMobileOpen(true)
              }}
            >
              <span className="row-time mono">{age(event.ts)}</span>
              <span className="row-mint">
                <strong>{event.symbol ? `$${event.symbol}` : shorten(event.mint)}</strong>
                <small>{event.dex} · {event.name || shorten(event.mint)}</small>
              </span>
              <span className="row-amount orange mono">
                {event.amountSol.toFixed(2)} SOL
                {event.amountUsd != null ? ` · $${event.amountUsd.toLocaleString()}` : ''}
              </span>
              <span className="row-sent mono">{event.sentOn ? 'yes' : 'no'}</span>
            </button>
          ))}
        </section>
        <Detail event={current} copy={copy} copied={copied} />
      </div>
      {current && mobileOpen && (
        <div className="mobile-sheet">
          <button className="sheet-close" onClick={() => setMobileOpen(false)}>close</button>
          <Detail event={current} copy={copy} copied={copied} />
        </div>
      )}
      <footer className="board-footer">
        <Link href="/">back</Link>
        <span className="mono">liquidity removes only</span>
      </footer>
    </main>
  )
}

function Detail({
  event,
  copy,
  copied,
}: {
  event?: PullEvent
  copy: (value: string) => void
  copied: string
}) {
  if (!event) {
    return (
      <aside className="detail-panel empty-detail">
        <span className="mono">select a pull</span>
      </aside>
    )
  }
  const CopyBtn = ({ value }: { value: string }) => (
    <button className="copy-button mono" onClick={() => copy(value)}>
      {copied === value ? 'copied' : 'copy'}
    </button>
  )
  return (
    <aside className="detail-panel">
      <div className="detail-heading">
        <span className="label">{event.symbol ? `$${event.symbol}` : 'selected pull'}</span>
        <span className="mono muted">{event.dex}</span>
      </div>
      <div className="detail-amount">
        <span className="label">sol out</span>
        <strong className="orange">{event.amountSol.toFixed(2)} SOL</strong>
        {event.amountUsd != null && (
          <span className="mono muted">${event.amountUsd.toLocaleString()}</span>
        )}
      </div>
      <DetailLine label="mint" value={event.mint} copy={<CopyBtn value={event.mint} />} />
      <DetailLine
        label="by"
        value={event.puller}
        copy={<CopyBtn value={event.puller} />}
        href={solscanAccount(event.puller)}
      />
      <DetailLine
        label="sent on"
        value={event.sentOn && event.sentTo ? `yes → ${event.sentTo}` : 'no'}
        copy={event.sentTo ? <CopyBtn value={event.sentTo} /> : null}
      />
      <DetailLine
        label="signature"
        value={event.signature}
        copy={<CopyBtn value={event.signature} />}
      />
      <div className="detail-links">
        <a href={solscanTx(event.signature)} target="_blank" rel="noreferrer">solscan</a>
        <a href={chartUrl(event.mint)} target="_blank" rel="noreferrer">chart</a>
      </div>
    </aside>
  )
}

function DetailLine({
  label,
  value,
  copy,
  href,
}: {
  label: string
  value: string
  copy: React.ReactNode
  href?: string
}) {
  return (
    <div className="detail-line">
      <span className="label">{label}</span>
      <div>
        {href ? (
          <a className="mono address" href={href} target="_blank" rel="noreferrer">{shorten(value)}</a>
        ) : (
          <span className="mono address">{value}</span>
        )}
        {copy}
      </div>
    </div>
  )
}
