# muslimbizhub-feed

The content feed for the MuslimBizHub app: the directory's categories, regions, market
categories and listing counts, read off [muslimbizhub.co.za](https://muslimbizhub.co.za).

The **Build feed** workflow runs every 6 hours. It rebuilds `content.json` from the live site
and commits it only when something on the site has changed. The app fetches it on launch from:

    https://raw.githubusercontent.com/Taariq-Faker78/muslimbizhub-feed/main/content.json

To update straight away after changing the site, open **Actions → Build feed → Run workflow**.

To build it locally: `node scripts/build-feed.mjs` (Node 20+).

The format is described in `docs/content-feed.md` in the app repo. Everything here is already
public on the website.
