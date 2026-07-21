export function CircularProgress({ percent }: { percent: number }) {
  const r = 6
  const circumference = 2 * Math.PI * r
  const offset = circumference - (percent / 100) * circumference

  return (
    <svg width="26" height="26" viewBox="0 0 16 16" className="shrink-0 block">
      <defs>
        <linearGradient id="progress-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#433485" />
          <stop offset="50%" stopColor="#b53cdd" />
          <stop offset="100%" stopColor="#d0a9e2" />
        </linearGradient>
      </defs>
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeWidth="2" opacity={0.1} />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="url(#progress-gradient)"
        strokeWidth="2"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 8 8)"
        className="transition-all duration-300"
      />
    </svg>
  )
}
