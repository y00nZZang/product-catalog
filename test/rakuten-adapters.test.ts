import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseBooksApi,
  resolveBooksCode,
} from "../src/merchants/rakuten/books";
import { identify } from "../src/domain";
import {
  parseRakutenApi,
  resolveRakutenItemCode,
} from "../src/merchants/rakuten/ichiba";
const books = identify("https://books.rakuten.co.jp/rb/18584086/");
const item = {
  title: "FJORD Blu-ray",
  itemUrl: books.canonicalUrl,
  jan: "4988031871201",
  itemPrice: 5672,
  availability: "5",
  postageFlag: 1,
};
test("Books API matches exact selling URL and barcode, preserves reservation and shipping semantics", () => {
  const p = parseBooksApi({ Items: [{ Item: item }] }, books, item.jan);
  assert.equal(p.price, 5672);
  assert.equal(p.availability, "preorder");
  assert.equal(p.domesticShipping.amount, 0);
  assert.equal(p.apiBooksCode, item.jan);
  assert.equal(
    parseBooksApi({ items: [{ ...item, postageFlag: 0 }] }, books, item.jan)
      .domesticShipping.amount,
    null,
  );
  assert.equal(
    parseBooksApi(
      { items: [{ ...item, postageFlag: 2, availability: "4" }] },
      books,
      item.jan,
    ).availability,
    "backorder",
  );
  assert.throws(() =>
    parseBooksApi(
      {
        Items: [
          { ...item, itemUrl: "https://books.rakuten.co.jp/rb/18584094/" },
        ],
      },
      books,
      item.jan,
    ),
  );
  assert.throws(() =>
    parseBooksApi(
      { Items: [{ ...item, jan: "0000000000000" }] },
      books,
      item.jan,
    ),
  );
});
test("Books identifier only comes from primary metadata, not recommendation barcodes", () => {
  assert.equal(
    resolveBooksCode(
      '<div id="productDetailedDescription"><ul><li>JAN： 4988031871201</li></ul></div><aside>JAN 4900000000000</aside>',
    ),
    item.jan,
  );
  assert.equal(
    resolveBooksCode(
      '<div id="productDetailedDescription"><li>JAN：4988031871201</li><li>JAN：4900000000000</li></div>',
    ),
    null,
  );
});
test("Ichiba purchase-form ID beats URL manage number and recommendation IDs", () => {
  const id = identify("https://item.rakuten.co.jp/smltrading/4582769995750/");
  const form =
    '<form><input name="shopurl" value="smltrading"><input name="item_number" value="4582769995750"><input name="item_id" value="10000821"></form>';
  assert.equal(
    resolveRakutenItemCode(
      form + "smltrading:4582769995750 smltrading:10000821 smltrading:99999999",
      id,
    ),
    "smltrading:10000821",
  );
  assert.equal(
    resolveRakutenItemCode(
      form.replace('value="4582769995750"', 'value="different"'),
      id,
    ),
    null,
  );
  const p = parseRakutenApi(
    {
      Items: [
        {
          itemCode: "smltrading:10000821",
          itemUrl: id.canonicalUrl,
          itemName: "Options",
          itemPrice: 1000,
          itemPriceMin1: 1000,
          itemPriceMax1: 2000,
          postageFlag: 0,
        },
      ],
    },
    id,
    "smltrading:10000821",
  );
  assert.equal(p.price, null);
  assert.equal(p.priceRange?.max, 2000);
  assert.equal(p.domesticShipping.amount, 0);
});
