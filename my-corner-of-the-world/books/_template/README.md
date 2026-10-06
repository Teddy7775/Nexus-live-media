# Adding a new volume

1. Copy this folder: `cp -r books/_template books/<your-slug>` and edit `book.json`
   (titles, slugs, blurbs, place, dates, print spec). Keep the three languages in step.
2. Drop the manuscripts in `manuscript/{en,fr,es}.md` and the guides in `guide/{en,fr,es}.md`
   (same Markdown conventions as Ananya’s Notebook: `# Title`, `## Part …`, `### Chapter …`, bold labels for dates/notes).
   Keep untouched copies in `manuscript/original/` and `guide/original/`; log every edit in `edits/*.json`
   and run `python3 tools/apply_edits.py` if you want the same traceable pipeline as Ananya’s Notebook.
3. Put illustrations in `art/source/` (or print masters in `art/final/`) and describe each in `art/register.json`.
4. Add the slug to `books` in `series.json` and (optionally) delete the matching entry from `upcoming`.
5. `python3 build.py check --book <your-slug>` then `python3 build.py all --book <your-slug>`.
   The website, sitemap, language switchers, collection page and downloads pick the book up automatically.
