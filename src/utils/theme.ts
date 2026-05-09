export function setAccentVars(hex: string, gradient: string) {
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-gradient', gradient);
  // parse hex → rgba for dim/glow
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  document.documentElement.style.setProperty('--accent-dim', `rgba(${r},${g},${b},0.12)`);
  document.documentElement.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.28)`);
  // update grid color
  document.documentElement.style.setProperty('--grid-color', `rgba(${r},${g},${b},0.07)`);
}
