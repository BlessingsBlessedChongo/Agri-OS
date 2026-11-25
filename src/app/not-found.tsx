import { LinkButton } from '@/ui/kit'

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <h1 className="font-display text-5xl font-extrabold tracking-wide">Nothing here</h1>
      <p className="mt-3 text-ink-2">The page or record you asked for doesn’t exist, or it belonged to a sandbox that has since been cleared.</p>
      <div className="mt-6 flex justify-center gap-3">
        <LinkButton href="/demo">Run a harvest</LinkButton>
        <LinkButton href="/" variant="secondary">
          Home
        </LinkButton>
      </div>
    </div>
  )
}
