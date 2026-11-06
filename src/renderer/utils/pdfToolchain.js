// jsPDF, autotable y la fuente Inter pesan ~1.7 MB: se cargan la primera vez que
// alguien exporta o imprime. Con imports estáticos cada pantalla que genera PDF
// pagaba ese peso al abrirse, aunque nunca se usara.
export const loadPdfToolchain = async () => {
  const [{ jsPDF }, { applyPlugin }, fontModule] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    import("../assets/fonts/inter.ttf?inline"),
  ]);
  applyPlugin(jsPDF);
  return { jsPDF, interFontInline: fontModule.default };
};
