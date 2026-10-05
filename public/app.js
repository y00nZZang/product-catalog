import { loadCurrentFx } from "./js/controllers/exchange-rate.js";
import { bindCustomsControls } from "./js/controllers/customs.js";
import {
  bindCatalogControls,
  loadHealth,
  refreshList,
} from "./js/controllers/catalog.js";
import { bindPackageControls } from "./js/controllers/package.js";

// Stable browser entrypoint: modules own the workflows, this file only initializes them.
bindCatalogControls();
bindPackageControls();
bindCustomsControls();
loadHealth();
refreshList();

loadCurrentFx();
