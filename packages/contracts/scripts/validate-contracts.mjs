import { readFile, readdir } from "node:fs/promises"
import { dirname, extname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import Ajv2020 from "ajv/dist/2020.js"
import addFormats from "ajv-formats"

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceDirectory = resolve(packageDirectory, "../..")
const contractsDirectory = join(workspaceDirectory, "contracts")
const definitionsDirectory = join(contractsDirectory, "definitions")
const manifestPath = join(contractsDirectory, "fixtures/device-onboarding/manifest.json")

async function jsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await jsonFiles(path)))
    } else if (extname(entry.name) === ".json") {
      files.push(path)
    }
  }

  return files.sort()
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

function formatErrors(errors) {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ")
}

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
})

addFormats(ajv)

const schemaPaths = await jsonFiles(definitionsDirectory)
const schemas = await Promise.all(schemaPaths.map(readJson))

for (const [index, schema] of schemas.entries()) {
  if (!schema.$id) {
    throw new Error(`${relative(workspaceDirectory, schemaPaths[index])} has no $id`)
  }

  if (!ajv.validateSchema(schema)) {
    throw new Error(
      `${relative(workspaceDirectory, schemaPaths[index])} is not a valid schema: ${formatErrors(ajv.errors)}`,
    )
  }

  ajv.addSchema(schema)
}

for (const schema of schemas) {
  if (!ajv.getSchema(schema.$id)) {
    throw new Error(`Could not compile schema ${schema.$id}`)
  }
}

const manifest = await readJson(manifestPath)
let failures = 0

for (const fixtureCase of manifest.cases) {
  const validate = ajv.getSchema(fixtureCase.schema_id)

  if (!validate) {
    throw new Error(`${fixtureCase.name}: unknown schema ${fixtureCase.schema_id}`)
  }

  const instancePath = join(contractsDirectory, fixtureCase.instance)
  const instance = await readJson(instancePath)
  const actual = validate(instance)

  if (actual !== fixtureCase.valid) {
    failures += 1
    process.stderr.write(
      `${fixtureCase.name}: expected valid=${fixtureCase.valid}, received valid=${actual}; ${formatErrors(validate.errors)}\n`,
    )
  }
}

if (failures > 0) {
  process.exitCode = 1
} else {
  process.stdout.write(
    `Validated ${schemas.length} schemas and ${manifest.cases.length} fixture cases.\n`,
  )
}
