import BrandLogo from "../components/BrandLogo";

/**
 * A local review sheet for the brand assets.
 *
 * It renders the real files that ship with the app, at the sizes they are
 * used at, on both a dark and a light surface.
 */
export default function BrandPage() {
  return (
    <main className="brand-sheet">
      <header className="brand-sheet-head">
        <BrandLogo variant="full" size={54} />
        <p className="hint">
          Owner review sheet for the BDM brand assets. Every item below is the
          exact file the application uses.
        </p>
      </header>

      <section className="brand-row">
        <div className="brand-tile brand-tile-dark">
          <BrandLogo variant="full" size={72} decorative />
          <span className="brand-tile-label">/brand/bdm-logo.svg</span>
        </div>
        <div className="brand-tile brand-tile-dark">
          <BrandLogo variant="emblem" size={120} decorative />
          <span className="brand-tile-label">/brand/bdm-emblem.svg</span>
        </div>
      </section>

      <section className="brand-row">
        <div className="brand-tile brand-tile-dark">
          <BrandLogo variant="mark" size={72} decorative />
          <span className="brand-tile-label">/brand/bdm-mark.svg · 72px</span>
        </div>
        <div className="brand-tile brand-tile-dark">
          <BrandLogo variant="mark" size={44} decorative />
          <span className="brand-tile-label">44px</span>
        </div>
        <div className="brand-tile brand-tile-dark">
          <BrandLogo variant="mark" size={28} decorative />
          <span className="brand-tile-label">28px</span>
        </div>
        <div className="brand-tile brand-tile-dark">
          <BrandLogo variant="mark" size={20} decorative />
          <span className="brand-tile-label">20px</span>
        </div>
      </section>

      <section className="brand-row">
        <div className="brand-tile brand-tile-light">
          <BrandLogo variant="mark" size={64} surface="light" decorative />
          <span className="brand-tile-label">/brand/bdm-mark-light.svg</span>
        </div>
        <div className="brand-tile brand-tile-dark">
          {/* eslint-disable-next-line @next/next/no-img-element -- raw asset preview */}
          <img src="/icon.svg" alt="Browser favicon" width={64} height={64} />
          <span className="brand-tile-label">/icon.svg · favicon</span>
        </div>
        <div className="brand-tile brand-tile-dark">
          {/* eslint-disable-next-line @next/next/no-img-element -- raw asset preview */}
          <img
            src="/icon-192.svg"
            alt="Home screen icon"
            width={64}
            height={64}
          />
          <span className="brand-tile-label">/icon-192.svg</span>
        </div>
      </section>

      <section className="brand-tile brand-tile-light brand-tile-wide">
        <h1 className="brand-h1">BDM Personal AI</h1>
        <p className="brand-p">
          Type sample for the wordmark. The heading uses the system UI stack so
          no remote font is ever loaded.
        </p>
      </section>
    </main>
  );
}
