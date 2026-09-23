// Metro resolves image imports to an asset id; `Image` accepts it as `source`.
declare module '*.png' {
  const asset: number;
  export default asset;
}
