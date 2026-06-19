// Busca dados da Copa do Mundo 2026 na football-data.org e grava em /data como JSON estático.
// Roda localmente (geração inicial) e via GitHub Actions (atualização periódica).
// Requer a variável de ambiente FOOTBALL_DATA_API_KEY.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE = "https://api.football-data.org/v4";
const COMPETITION = "WC";
const TOKEN = process.env.FOOTBALL_DATA_API_KEY;

if (!TOKEN) {
  console.error("Erro: defina a variável de ambiente FOOTBALL_DATA_API_KEY.");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

async function getJSON(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "X-Auth-Token": TOKEN },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Falha em ${path}: HTTP ${res.status} - ${body}`);
  }
  return res.json();
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  console.log("Buscando partidas...");
  const matchesPayload = await getJSON(`/competitions/${COMPETITION}/matches`);

  console.log("Buscando classificação...");
  const standingsPayload = await getJSON(`/competitions/${COMPETITION}/standings`);

  const meta = {
    fetchedAt: new Date().toISOString(),
    competition: matchesPayload.competition ?? null,
    season: matchesPayload.matches?.[0]?.season ?? null,
    totalMatches: matchesPayload.resultSet?.count ?? matchesPayload.matches?.length ?? 0,
    matchesPlayed: matchesPayload.resultSet?.played ?? null,
  };

  await writeFile(
    join(DATA_DIR, "matches.json"),
    JSON.stringify({ matches: matchesPayload.matches ?? [] }, null, 2),
  );
  await writeFile(
    join(DATA_DIR, "standings.json"),
    JSON.stringify({ standings: standingsPayload.standings ?? [] }, null, 2),
  );
  await writeFile(join(DATA_DIR, "meta.json"), JSON.stringify(meta, null, 2));

  console.log(`OK - ${meta.totalMatches} partidas, classificação com ${standingsPayload.standings?.length ?? 0} grupos.`);
  console.log(`Atualizado em: ${meta.fetchedAt}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
