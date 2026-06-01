import { Project, SyntaxKind, Node, type SourceFile, type ParameterDeclaration } from 'ts-morph';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import type { ComponentSignature, ComponentsManifest, PropDefinition } from './types.js';

function resolveComponentName(sf: SourceFile): string | undefined {
  for (const [key, decls] of sf.getExportedDeclarations()) {
    let candidate = key;
    if (key === 'default') {
      for (const decl of decls) {
        if (Node.isFunctionDeclaration(decl) && decl.getName()) { candidate = decl.getName()!; break; }
        if (Node.isVariableDeclaration(decl)) { candidate = decl.getName(); break; }
        if (Node.isClassDeclaration(decl) && decl.getName()) { candidate = decl.getName()!; break; }
        if (Node.isIdentifier(decl)) { candidate = decl.getText(); break; }
      }
    }
    if (/^[A-Z]/.test(candidate)) return candidate;
  }
  return undefined;
}

function propsFromParams(params: ParameterDeclaration[]): PropDefinition[] {
  if (params.length === 0) return [];
  const nameNode = params[0].getNameNode();
  if (!Node.isObjectBindingPattern(nameNode)) return [];
  const results: PropDefinition[] = [];
  for (const el of nameNode.getElements().slice(0, 40)) {
    if (el.getDotDotDotToken()) continue;
    const propName = el.getPropertyNameNode()?.getText() ?? el.getNameNode().getText();
    results.push({ name: propName, type: 'unknown', optional: el.getInitializer() !== undefined });
  }
  return results;
}

function propsFromDestructuring(sf: SourceFile, name: string): PropDefinition[] {
  const func = sf.getFunction(name);
  if (func) return propsFromParams(func.getParameters());

  const varDecl = sf.getVariableDeclaration(name);
  if (varDecl) {
    const init = varDecl.getInitializer();
    if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
      return propsFromParams(init.getParameters());
    }
  }
  return [];
}

function extractComponent(filePath: string, srcDir: string, project: Project): ComponentSignature | undefined {
  const sf = project.getSourceFile(filePath);
  if (!sf) return undefined;

  const componentName = resolveComponentName(sf);
  if (!componentName) return undefined;

  let props: PropDefinition[] = [];
  const iface = sf.getInterface(`${componentName}Props`) ?? sf.getInterface('Props');
  if (iface) {
    for (const prop of iface.getProperties().slice(0, 40)) {
      props.push({ name: prop.getName(), type: prop.getTypeNode()?.getText() ?? 'unknown', optional: prop.hasQuestionToken() });
    }
  } else {
    const alias = sf.getTypeAlias(`${componentName}Props`) ?? sf.getTypeAlias('Props');
    const typeNode = alias?.getTypeNode()?.asKind(SyntaxKind.TypeLiteral);
    if (typeNode) {
      for (const member of typeNode.getProperties().slice(0, 40)) {
        const ps = member.asKind(SyntaxKind.PropertySignature);
        if (ps) props.push({ name: ps.getName(), type: ps.getTypeNode()?.getText() ?? 'unknown', optional: ps.hasQuestionToken() });
      }
    } else {
      props = propsFromDestructuring(sf, componentName);
    }
  }

  const opening = sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement);
  const selfClosing = sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement);
  const allJsx = [...opening, ...selfClosing].sort((a, b) => a.getPos() - b.getPos());
  const jsxTags: string[] = [];
  for (const node of allJsx.slice(0, 60)) {
    const tag = node.getTagNameNode().getText();
    if (/^[a-z]/.test(tag)) jsxTags.push(tag);
  }

  const imports: string[] = [];
  for (const decl of sf.getImportDeclarations()) {
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

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: false,
    compilerOptions: { allowJs: true, jsx: 2 /* React */ },
  });
  project.addSourceFilesAtPaths([join(srcDir, '**/*.tsx'), join(srcDir, '**/*.jsx')]);

  const sourceFiles = project.getSourceFiles();
  console.log(`Scanning ${sourceFiles.length} .tsx/.jsx files in ${config.srcDir}...`);

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
