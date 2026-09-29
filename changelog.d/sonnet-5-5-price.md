### Changed
- The FUEL price table (`server/fuel-prices.json`) prices `claude-sonnet-5-5` at the list price ($2 in, $10 out, cache read 0.1×, the same as Sonnet 5). Before, FUEL counted its requests as unpriced, because a model is priced only by its exact name ([docs/fuel.md](docs/fuel.md) 8.4).
