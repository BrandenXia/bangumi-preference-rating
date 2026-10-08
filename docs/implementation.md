# Implementation notes

The supplied plan is a reference. This version prioritizes a working native component over a framework, plugin registry, backend, cloud sync, or a large test suite. One esbuild bundle, TypeScript, browser APIs, and a handful of modules are enough.

## Platform findings (2026-10-08)

- [Component scopes](https://bgm.tv/group/topic/345291) use userscript metadata; this bundle matches all pages on the three Bangumi hosts so settings are available everywhere. The subject action itself checks the exact detail route and API subject type.
- [Personalization](https://bgm.tv/group/topic/435098) exposes `chiiLib.ukagaka.addGeneralConfig`. It is optional; the comparison dialog also has settings.
- [Cloud settings](https://bgm.tv/group/topic/435662) load on every page and are deleted on disabling a component. History stays in IndexedDB, one record per numeric user ID, separately on each origin.
- [Official v0 schema](https://github.com/bangumi/api/blob/master/open-api/v0.yaml) allows public collections without a bearer token, with `subject_type=2`, offset pagination, and limit at most 50. Private collections require authorization. Collection status and zero ratings do not count toward eligibility.
- [OAuth](https://github.com/bangumi/api/blob/master/docs-raw/How-to-Auth.md) requires a client secret for the documented code exchange. We do not embed secrets or assume site cookies authorize the API. This release has no remote write path. Integer recommendations can be entered manually in Bangumi's existing controls.
- The public subject page and read-only subject API were fetched successfully. The developer component editor requires login. Native install, authenticated identity markup, personalization execution, private collections, cross-origin browser fetching, and all three hostnames still require a signed-in browser check. No remote ratings were changed.

## Scope

Ship: paginated public imports, 50-rating gate, local comparison history, adaptive references, undo/skip/tie, saved precise estimates, two algorithms, backup/restore. Native DOM integration is best effort and fails closed when the logged-in navigation identity cannot be detected. Failed imports keep the previous snapshot. Successful imports revalidate eligibility, even when it falls below 50; past comparisons and records remain.

Defer: authenticated publishing, private collection access, full hierarchical Bayesian inference, learned ordinal thresholds, globally refitting every anchor, and cloud synchronization. These do not justify extra architecture in the first version.
