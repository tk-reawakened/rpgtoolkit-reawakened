/** A bundler loads an RPGCode program as its text (the browser entry's bundled `package/startup.prg`). */
declare module "*.prg" {
  const source: string;
  export default source;
}
