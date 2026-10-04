import type { Ref } from 'react'
import { content } from '../content'
import type { CharacterState } from '../character/engine'

const STATUS: Record<CharacterState, string> = {
  working: 'Heads down, shipping',
  glancing: 'Hm?',
  noticing: 'Oh, hi there',
  watching: 'Watching your cursor',
  settling: 'Getting back to it',
  returning: 'Back to work',
  cheers: 'Cheers',
  leaning: "You're in the way",
  eyebrow: 'Can I help you?',
  headphones: 'Headphones on. Ignoring you.',
}

const touch = window.matchMedia('(hover: none)').matches

interface Props {
  charState: CharacterState
  reduced: boolean
  hintSeen: boolean
  stageRef: Ref<HTMLDivElement>
  canvasRef: Ref<HTMLCanvasElement>
  onCharacterClick: () => void
}

export function Hero({ charState, reduced, hintSeen, stageRef, canvasRef, onCharacterClick }: Props) {
  return (
    <>
      <header className="nav">
        <a className="nav__mark" href="#" data-reveal>
          {content.mark}
        </a>
        {!reduced && (
          <p className="status mono" data-reveal aria-live="polite">
            <i className="pulse" />
            {STATUS[charState]}
          </p>
        )}
        <nav className="nav__links" data-reveal>
          {content.links.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </nav>
      </header>

      <section className="hero">
        <div className="hero__copy">
          <p className="eyebrow mono">
            <span data-reveal>{content.role}</span>
          </p>
          <h1 className="hero__name">
            <span className="line">
              <span data-reveal>{content.name}</span>
            </span>
          </h1>
          <p className="hero__lede" data-reveal>
            {content.tagline}
          </p>
          <div className="hero__cta" data-reveal>
            <a className="btn" href={content.cta.primary.href}>
              {content.cta.primary.label}
              <span aria-hidden>↓</span>
            </a>
            <a className="link" href={content.cta.secondary.href}>
              {content.cta.secondary.label} <span aria-hidden>→</span>
            </a>
          </div>
        </div>

        <div className="stage" ref={stageRef}>
          <div className="stage__clip">
            {reduced ? (
              <img src="/media/poster.webp" alt={`Illustrated ${content.name} working at a laptop`} />
            ) : (
              <canvas
                ref={canvasRef}
                role="img"
                aria-label={`Illustrated ${content.name} at a laptop. He looks up and follows your cursor; click him for a coffee cheers.`}
                onClick={onCharacterClick}
              />
            )}
          </div>
          {!reduced && (
            <div className="stage__hint" data-reveal>
              <p className={hintSeen ? 'mono is-gone' : 'mono'}>
                <svg viewBox="0 0 40 24" aria-hidden>
                  <path d="M38 4C28 2 14 4 5 17m0 0 1-7m-1 7 7-2" />
                </svg>
                {touch
                  ? 'Tap around, he notices. Tap him for a coffee break.'
                  : 'Go on, bother him. Click him. Then click him again.'}
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
