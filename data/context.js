/*
 * Who Lived When? — capas de contexto
 * -------------------------------------------------------------
 * Reproduce la "logica" del poster original mas alla de las personas:
 *
 *  WLW_ERAS      : franjas de fondo con una duracion (Renacimiento, etc.)
 *  WLW_EVENTS    : hitos puntuales en un anio (Colon 1492, Luna 1969...)
 *  WLW_GROUPS    : cajas tematicas que encierran a un conjunto de personas
 *  WLW_RELATIONS : conectores entre dos personas (maestro de, amigos...)
 *
 * Las personas se referencian por su `name` exacto (ver people.js).
 */

window.WLW_ERAS = [
  { name: "Antiguedad clasica", b: -800, d: 476, color: "#c9bfa0" },
  { name: "Imperio Romano", b: -27, d: 476, color: "#bcae86" },
  { name: "Imperio Bizantino", b: 330, d: 1453, color: "#c9bfa0" },
  { name: "Edad Media", b: 476, d: 1453, color: "#bcae86" },
  { name: "Edad de los Descubrimientos", b: 1400, d: 1600, color: "#c9bfa0" },
  { name: "Renacimiento", b: 1400, d: 1600, color: "#bcae86" },
  { name: "Ilustracion", b: 1685, d: 1815, color: "#c9bfa0" },
  { name: "Revolucion Industrial", b: 1760, d: 1840, color: "#bcae86" },
  { name: "Era de la Informacion", b: 1950, d: 2026, color: "#c9bfa0" }
];

window.WLW_EVENTS = [
  { year: 476, label: "Caida del Imperio Romano de Occidente" },
  { year: 1215, label: "Carta Magna" },
  { year: 1347, label: "Comienza la Peste Negra" },
  { year: 1453, label: "Caida de Constantinopla" },
  { year: 1492, label: "Colon llega a America" },
  { year: 1789, label: "Revolucion Francesa" },
  { year: 1776, label: "Independencia de EE.UU." },
  { year: 1914, label: "Comienza la I Guerra Mundial" },
  { year: 1929, label: "Crack de la Bolsa" },
  { year: 1939, label: "Comienza la II Guerra Mundial" },
  { year: 1969, label: "El hombre llega a la Luna" },
  { year: 1991, label: "Nace la World Wide Web" }
];

window.WLW_GROUPS = [
  {
    name: "Filosofos griegos",
    members: ["Socrates", "Platon", "Aristoteles"]
  },
  {
    name: "Revolucion cientifica",
    members: ["Nicolas Copernico", "Galileo Galilei", "Johannes Kepler", "Isaac Newton"]
  },
  {
    name: "Edad de Oro de la Pirateria",
    members: ["Henry Morgan", "Captain Kidd", "Calico Jack", "Anne Bonny", "Barbanegra"]
  },
  {
    name: "Padres fundadores de EE.UU.",
    members: ["George Washington", "Benjamin Franklin", "Thomas Jefferson", "John Adams", "Alexander Hamilton"]
  },
  {
    name: "Impresionistas",
    members: ["Edouard Manet", "Claude Monet", "Auguste Renoir", "Paul Cezanne"]
  },
  {
    name: "Existencialistas",
    members: ["Jean-Paul Sartre", "Simone de Beauvoir", "Albert Camus"]
  },
  {
    name: "The Beatles",
    members: ["John Lennon", "Paul McCartney"]
  }
];

window.WLW_RELATIONS = [
  { a: "Socrates", b: "Platon", label: "maestro de" },
  { a: "Platon", b: "Aristoteles", label: "maestro de" },
  { a: "Aristoteles", b: "Alejandro Magno", label: "tutor de" },
  { a: "Karl Marx", b: "Friedrich Engels", label: "colaboradores" },
  { a: "Jean-Paul Sartre", b: "Simone de Beauvoir", label: "pareja" },
  { a: "Marie Curie", b: "Albert Einstein", label: "amigos" },
  { a: "Steve Jobs", b: "Bill Gates", label: "rivales" },
  { a: "John Lennon", b: "Paul McCartney", label: "companeros" },
  { a: "Calico Jack", b: "Anne Bonny", label: "companeros" }
];
