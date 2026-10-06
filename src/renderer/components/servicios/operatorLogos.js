/**
 * Logos de operador.
 *
 * Cada logo es un archivo suelto en `src/renderer/assets/operators/`. Para
 * cambiar o agregar uno basta con dejar el `.svg` con el nombre del `key` del
 * operador — no se toca código. Si el archivo no existe, `OperatorIcon` cae a
 * las iniciales sobre el color de la marca, así la pantalla nunca se rompe.
 *
 * Estos SVG son wordmarks de respaldo (nombre sobre el color de la marca).
 * Para poner el logo oficial, reemplaza el archivo por el SVG que el operador
 * tenga en su portal de marca y listo.
 */
import amazon from "@/assets/operators/amazon.svg";
import apple from "@/assets/operators/apple.svg";
import att from "@/assets/operators/att.svg";
import cfe from "@/assets/operators/cfe.svg";
import googlePlay from "@/assets/operators/google-play.svg";
import megacable from "@/assets/operators/megacable.svg";
import movistar from "@/assets/operators/movistar.svg";
import naturgy from "@/assets/operators/naturgy.svg";
import netflix from "@/assets/operators/netflix.svg";
import playstation from "@/assets/operators/playstation.svg";
import samsung from "@/assets/operators/samsung.svg";
import spotify from "@/assets/operators/spotify.svg";
import telcel from "@/assets/operators/telcel.svg";
import telmex from "@/assets/operators/telmex.svg";
import virgin from "@/assets/operators/virgin.svg";
import xbox from "@/assets/operators/xbox.svg";

export const OPERATOR_LOGOS = {
  telcel,
  movistar,
  att,
  virgin,
  amazon,
  "google-play": googlePlay,
  netflix,
  apple,
  samsung,
  xbox,
  playstation,
  spotify,
  cfe,
  telmex,
  megacable,
  naturgy,
};

/** Nombre corto para cuando no hay archivo y hay que pintar iniciales. */
export const OPERATOR_FALLBACK_NAME = {
  telcel: "Telcel",
  movistar: "Movistar",
  att: "AT&T",
  virgin: "Virgin",
  amazon: "Amazon",
  "google-play": "Google Play",
  netflix: "Netflix",
  apple: "Apple",
  samsung: "Samsung",
  xbox: "Xbox",
  playstation: "PlayStation",
  spotify: "Spotify",
  cfe: "CFE",
  telmex: "Telmex",
  megacable: "Megacable",
  naturgy: "Naturgy",
};