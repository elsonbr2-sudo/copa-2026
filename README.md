# Copa do Mundo 2026 — Jogos, Resultados e Classificação

Site estático (HTML/CSS/JS puro) com os jogos do dia, resultados e classificação por grupos da Copa do Mundo FIFA 2026, usando dados da [football-data.org](https://www.football-data.org/).

## Por que os dados não são buscados direto no navegador

A API da football-data.org só libera CORS para `localhost`. Buscar os dados diretamente do navegador funcionaria localmente, mas seria bloqueado quando o site estivesse no GitHub Pages — e exporia sua chave de API para qualquer visitante.

Por isso, a chave fica só no servidor (GitHub Actions), nunca no código do site:

1. Uma GitHub Action (`.github/workflows/update-data.yml`) roda a cada 10 minutos, chama a API com a chave guardada em **Secrets** e grava o resultado em `data/*.json`.
2. O site (`app.js`) lê esses arquivos JSON estáticos, que estão no mesmo domínio — sem CORS, sem chave exposta.

## Como publicar no GitHub Pages

1. Crie um repositório no GitHub e suba esta pasta:
   ```bash
   git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
   git push -u origin main
   ```
2. No repositório, vá em **Settings → Secrets and variables → Actions → New repository secret**:
   - Nome: `FOOTBALL_DATA_API_KEY`
   - Valor: sua chave da football-data.org
3. Vá em **Settings → Pages** e selecione a branch `main`, pasta `/ (root)`.
4. (Opcional) Rode a Action manualmente em **Actions → Atualizar dados da Copa 2026 → Run workflow** para forçar uma atualização imediata.

O site ficará disponível em `https://SEU_USUARIO.github.io/SEU_REPOSITORIO/`.

## Atualizar os dados manualmente em local

```bash
FOOTBALL_DATA_API_KEY=sua_chave node scripts/fetch-data.mjs
```

Isso regrava `data/matches.json`, `data/standings.json` e `data/meta.json`.

## Limitações conhecidas

- O plano gratuito da football-data.org tem limite de 10 requisições/minuto — o intervalo de 10 minutos da Action fica bem dentro do limite.
- O agendamento (`cron`) do GitHub Actions é "melhor esforço": pode atrasar alguns minutos em horários de pico, e o GitHub desativa workflows agendados automaticamente após 60 dias sem nenhum commit no repositório (basta rodar manualmente uma vez para reativar).
- O site mostra "AO VIVO" tanto quando a API já marca a partida como em andamento quanto, como reforço, quando o horário atual está dentro da janela estimada da partida — assim o selo não fica "atrasado" entre uma atualização e outra da Action.
