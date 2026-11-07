export const css = `
  .slick-self-care {
    position: fixed;
    inset: 0;
    box-sizing: border-box;
    width: 100vw;
    height: 100dvh;
    max-width: none;
    max-height: none;
    margin: 0;
    border: 0;
    padding: 32px;
    background: var(--dt_color-base-pry, #fff);
    color: var(--dt_color-content-pry, #1d1c1d);
    font-family: inherit;
    text-align: center;
  }
  .slick-self-care[open] { display: grid; place-items: center; }
  .slick-self-care::backdrop { background: var(--dt_color-base-pry, #fff); }
  .slick-self-care__content { max-width: 480px; }
  .slick-self-care__symbol { font-size: 48px; margin-bottom: 24px; }
  .slick-self-care h1 { font-size: 32px; line-height: 1.2; margin: 0 0 16px; }
  .slick-self-care p { font-size: 17px; line-height: 1.6; overflow-wrap: anywhere; white-space: pre-wrap; }
  .slick-self-care__countdown {
    font-size: clamp(32px, 7vw, 56px);
    line-height: 1.4;
    font-variant-numeric: tabular-nums;
    margin: 28px 0 8px;
  }
  .slick-self-care .slick-self-care__end { font-size: 14px; opacity: .7; }
  .slick-self-care-panel { max-width: 480px; }
  .slick-self-care-panel label { display: block; font-weight: 700; margin: 20px 0 8px; }
  .slick-self-care-panel input { width: 120px; margin-bottom: 20px; }
`;
