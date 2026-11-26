import { getStore } from "@netlify/blobs";
import { createHandler } from "../lib/handler.mjs";
export default createHandler(getStore);
