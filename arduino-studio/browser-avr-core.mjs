// The Arduino source and all intermediate files stay inside the worker.
const toolRoot = "https://cdn.jsdelivr.net/npm/@horang-corp/avr-gcc-wasm@0.2.0/tools/";
const parserRoot = "https://cdn.jsdelivr.net/npm/web-tree-sitter@0.25.10/";
const cppGrammar = "https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.13/out/tree-sitter-cpp.wasm";

function put(fs, path, data) {
  const folders = path.split("/").slice(1, -1);
  let dir = "";
  for (const folder of folders) {
    dir += "/" + folder;
    if (!fs.analyzePath(dir).exists) fs.mkdir(dir);
  }
  fs.writeFile(path, data);
}

async function runTool(name, args, files, output, root) {
  let factory;
  const diagnostics = [];
  let tool;
  try {
    ({ default: factory } = await import(root + name + ".mjs"));
    tool = await factory({
      noInitialRun: true,
      locateFile: () => root + name + ".wasm",
      print: (line) => diagnostics.push(line),
      printErr: (line) => diagnostics.push(line),
    });
  } catch (cause) {
    throw new Error("브라우저 컴파일러를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.", { cause });
  }
  for (const [path, bytes] of files) put(tool.FS, path, bytes);
  let exit;
  try {
    exit = tool.callMain([...args]);
  } catch (error) {
    if (error.status !== 0) exit = error.status || 1;
  }
  if (exit) throw new Error(diagnostics.join("\n") || name + " 컴파일 오류");
  try {
    return tool.FS.readFile(output);
  } catch {
    throw new Error(diagnostics.join("\n") || name + " 결과 파일을 만들지 못했습니다.");
  }
}

async function openAssets(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Arduino 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.");
  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).json();
}

async function sketchWithPrototypes(source, loadParser) {
  const parser = await loadParser();
  const tree = parser.parse(source);
  try {
    const functions = tree.rootNode.namedChildren.filter((node) => node.type === "function_definition");
    const prototypes = [];
    for (const func of functions) {
      const declarator = func.childForFieldName("declarator");
      const body = func.childForFieldName("body");
      if (!body || declarator?.type !== "function_declarator") continue;
      const name = declarator.childForFieldName("declarator");
      const params = declarator.childForFieldName("parameters");
      if (name?.type !== "identifier" || !params || params.namedChildren.some(
        (param) => param.type === "optional_parameter_declaration"
      )) continue;
      prototypes.push(source.slice(func.startIndex, body.startIndex).trimEnd() + ";");
    }
    if (!prototypes.length) return source;
    const first = functions[0];
    return source.slice(0, first.startIndex) + "\n" + prototypes.join("\n") +
      '\n#line ' + (first.startPosition.row + 1) + ' "Sketch.ino"\n' + source.slice(first.startIndex);
  } finally {
    tree.delete();
    parser.delete();
  }
}

async function browserParser() {
  const { Parser, Language } = await import(parserRoot + "tree-sitter.js");
  await Parser.init({ locateFile: (name) => parserRoot + name });
  const parser = new Parser();
  parser.setLanguage(await Language.load(cppGrammar));
  return parser;
}

export async function compileSketch(source, target, options = {}) {
  if (!["uno", "nano", "nanoOldBootloader"].includes(target)) throw new Error("지원하지 않는 보드입니다.");
  const isUno = target === "uno";
  const board = isUno ? "UNO" : "NANO";
  const variant = isUno ? "standard" : "eightanaloginputs";
  const flash = isUno ? 32256 : 30720;
  const root = options.toolRoot ?? toolRoot;
  const assets = await openAssets(options.assetsUrl ?? new URL("./browser-avr-1.json.gz", import.meta.url));
  const files = Object.entries(assets).map(([path, bytes]) => [path, Uint8Array.from(atob(bytes), (char) => char.charCodeAt(0))]);
  const headers = files.filter(([path]) => !path.startsWith("/lib/"));
  const libs = files.filter(([path]) => path.startsWith("/lib/") && !path.endsWith(isUno ? "/NANO.a" : "/UNO.a"));
  const includeDirs = [...new Set(headers.filter(([path]) => path.startsWith("/libraries/"))
    .map(([path]) => path.slice(0, path.lastIndexOf("/"))))];
  const input = "/build/Sketch.cpp";
  const asm = "/build/Sketch.s";
  const obj = "/build/Sketch.o";
  const elf = "/build/Sketch.elf";
  const hex = "/build/Sketch.hex";
  const args = [
    "-quiet", "-imultilib", "avr5", "-D__AVR_ATmega328P__", "-D__AVR_DEVICE_NAME__=atmega328p",
    "-DF_CPU=16000000L", "-DARDUINO=10819", "-DARDUINO_ARCH_AVR", "-DARDUINO_AVR_" + board,
    "-isystem", "/gcc", "-isystem", "/avr", "-I", "/core", "-I", "/variant/" + variant,
    ...includeDirs.flatMap((path) => ["-I", path]), "-mmcu=avr5", "-mn-flash=1", "-mno-skip-bug",
    "-dumpbase", "Sketch.cpp", "-auxbase-strip", asm, "-Os", "-std=gnu++11", "-fpermissive", "-fno-exceptions", "-fno-threadsafe-statics",
    "-fno-rtti", "-fno-enforce-eh-specs", "-ffunction-sections", "-fdata-sections", input, "-o", asm,
  ];
  const assembleSource = (code) => runTool("cc1plus", args, [
    ...headers, [input, '#include <Arduino.h>\n#line 1 "Sketch.ino"\n' + code],
  ], asm, root);

  let assembly;
  try {
    assembly = await assembleSource(source);
  } catch (error) {
    if (!error.message.includes("was not declared in this scope")) throw error;
    const expanded = await sketchWithPrototypes(source, options.loadParser ?? browserParser).catch(() => source);
    if (expanded === source) throw error;
    assembly = await assembleSource(expanded);
  }

  const object = await runTool("avr-as", ["-mmcu=atmega328p", "-o", obj, asm], [[asm, assembly]], obj, root);
  const linked = await runTool("avr-ld", [
    "-m", "avr5", "--defsym=__DATA_REGION_ORIGIN__=0x800100", "--defsym=__DATA_REGION_LENGTH__=0x800",
    "--defsym=__TEXT_REGION_LENGTH__=" + flash, "-T", "/lib/avr5.xn", "--gc-sections",
    "-o", elf, "/lib/crtatmega328p.o", obj, "-L/lib", "--start-group",
    "/lib/" + board + ".a", "-lm", "-lc", "-lgcc", "-latmega328p", "--end-group",
  ], [...libs, [obj, object]], elf, root);
  const result = await runTool("avr-objcopy", ["-O", "ihex", "-R", ".eeprom", elf, hex], [[elf, linked]], hex, root);
  return new TextDecoder().decode(result);
}
