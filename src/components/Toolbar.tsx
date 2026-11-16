export type Background = 'transparent' | 'white' | 'black' | 'custom'

type Props = {
  background: Background
  color: string
  onBackground: (b: Background) => void
  onColor: (c: string) => void
  onDownload: () => void
  disabled: boolean
}

export function Toolbar({ background, color, onBackground, onColor, onDownload, disabled }: Props) {
  return (
    <div className="toolbar">
      <fieldset className="toolbar__backgrounds">
        <legend>Background</legend>
        {(['transparent', 'white', 'black', 'custom'] as const).map((b) => (
          <label key={b}>
            <input type="radio" name="background" checked={background === b} onChange={() => onBackground(b)} /> {b}
          </label>
        ))}
        <input
          type="color"
          value={color}
          aria-label="Custom colour"
          onChange={(e) => {
            onColor(e.target.value)
            onBackground('custom')
          }}
        />
      </fieldset>
      <button type="button" className="toolbar__download" onClick={onDownload} disabled={disabled}>
        Download PNG
      </button>
    </div>
  )
}
