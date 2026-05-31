import { Project, SyntaxKind } from 'ts-morph';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import type { ComponentSignature, ComponentsManifest, PropDefinition } from './types.js';

function extractComponent(filePath: string, srcDir: string, project: Project): ComponentSignature | undefined {
  const sourceFile = project.getSourceFile(filePath);
  if (!sourceFile) return undefined;

  let componentName: string | undefined;
  for (const [name] of sourceFile.getExportedDeclarations()) {
    if (/^[A-Z]/.test(name)) { componentName = name; break; }
  }
  if (!componentName) return undefined;

  const props: PropDefinition[] = [];
  const iface = sourceFile.getInterface(`${componentName}Props`) ?? sourceFile.getInterface('Props');
  if (iface) {
    for (const prop of iface.getProperties().slice(0, 40)) {
      props.push({ name: prop.getName(), type: prop.getTypeNode()?.getText() ?? 'unknown', optional: prop.hasQuestionToken() });
    }
  } else {
    const alias = sourceFile.getTypeAlias(`${componentName}Props`) ?? sourceFile.getTypeAlias('Props');
    const typeNode = alias?.getTypeNode()?.asKind(SyntaxKind.TypeLiteral);
    if (typeNode) {
      for (const member of typeNode.getProperties().slice(0, 40)) {
        const ps = member.asKind(SyntaxKind.PropertySignature);
        if (ps) props.push({ name: ps.getName(), type: ps.getTypeNode()?.getText() ?? 'unknown', optional: ps.hasQuestionToken() });
      }
    }
  }

  const opening = sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement);
  const selfClosing = sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement);
  const allJsx = [...opening, ...selfClosing].sort((a, b) => a.getPos() - b.getPos());
  const jsxTags: string[] = [];
  for (const node of allJsx.slice(0, 60)) {
    const tag = node.getTagNameNode().getText();
    if (/^[a-z]/.test(tag)) jsxTags.push(tag);
  }

  const imports: string[] = [];
  for (const decl of sourceFile.getImportDeclarations()) {
    const def = decl.getDefaultImport();
    if (def) imports.push(def.getText());
    for (const named of decl.getNamedImports()) imports.push(named.getName());
  }

  return {
    name: componentName,
    filePath,
    relativePath: relative(srcDir, filePath).split('\\').join('/'),
    imports: [...new Set(imports)],
    props,
    jsxTags,
    jsxDepth: jsxTags.length,
  };
}

export async function scan(configPath?: string): Promise<ComponentsManifest> {
  const config = await loadConfig(configPath);
  const srcDir = resolve(process.cwd(), config.srcDir);
  const outDir = resolve(process.cwd(), config.outDir);

  const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: false });
  project.addSourceFilesAtPaths(join(srcDir, '**/*.tsx'));

  const sourceFiles = project.getSourceFiles();
  console.log(`Scanning ${sourceFiles.length} .tsx files in ${config.srcDir}...`);

  const components: ComponentSignature[] = [];
  for (const sf of sourceFiles) {
    try {
      const sig = extractComponent(sf.getFilePath(), srcDir, project);
      if (sig) components.push(sig);
    } catch (err) {
      console.warn(`  Skipping ${sf.getBaseName()}: ${(err as Error).message}`);
    }
  }

  const manifest: ComponentsManifest = { scannedAt: new Date().toISOString(), srcDir, components };
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'components-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Found ${components.length} components → ${config.outDir}/components-manifest.json`);
  return manifest;
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  scan().catch((err) => { console.error(err); process.exit(1); });
}
