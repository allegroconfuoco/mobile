// Déclarations de modules pour les assets importés directement (metro les résout en identifiant
// numérique d'asset). `expo/types` couvre les images/CSS mais pas les polices : on déclare donc
// `*.ttf` ici pour typer `import Police from '.../police.ttf'` (police locale chargée via useFonts).
declare module '*.ttf' {
  const asset: number;
  export default asset;
}
