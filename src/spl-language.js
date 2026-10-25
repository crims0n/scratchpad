// SPDX-License-Identifier: GPL-3.0-or-later

// Splunk Search Processing Language (SPL) for Highlight.js. Highlight.js has
// no bundled SPL grammar; this one covers the readable core of a search:
// piped commands, field assignments, function calls, strings, numbers,
// macros, and triple-backtick comments.

export const SPL_COMMANDS = [
  "abstract", "accum", "addcoltotals", "addinfo", "addtotals", "analyzefields", "anomalies",
  "anomalousvalue", "append", "appendcols", "appendpipe", "arules", "associate", "autoregress",
  "bin", "bucket", "bucketdir", "chart", "cluster", "collect", "concurrency", "contingency",
  "convert", "correlate", "datamodel", "dbinspect", "dedup", "delete", "delta", "diff",
  "eval", "eventcount", "eventstats", "extract", "fieldformat", "fields", "fieldsummary",
  "filldown", "fillnull", "findtypes", "foreach", "format", "from", "gauge", "gentimes",
  "geom", "geostats", "head", "highlight", "history", "iconify", "inputcsv", "inputlookup",
  "iplocation", "join", "kmeans", "kv", "kvform", "loadjob", "localize", "lookup",
  "makecontinuous", "makemv", "makeresults", "map", "mcollect", "metadata", "metasearch",
  "mstats", "multikv", "multisearch", "mvcombine", "mvexpand", "nomv", "outlier", "outputcsv",
  "outputlookup", "outputtext", "overlap", "predict", "rangemap", "rare", "regex", "relevancy",
  "reltime", "rename", "replace", "rest", "return", "reverse", "rex", "rtorder", "savedsearch",
  "script", "search", "searchtxn", "selfjoin", "sendemail", "set", "sichart", "sitop",
  "sistats", "sitimechart", "sort", "spath", "stats", "strcat", "streamstats", "table",
  "tags", "tail", "timechart", "timewrap", "top", "transaction", "transpose", "trendline",
  "tscollect", "tstats", "typeahead", "typer", "union", "uniq", "untable", "where", "x11",
  "xmlkv", "xmlunescape", "xpath", "xyseries"
];

export function splLanguage(hljs) {
  return {
    name: "SPL",
    aliases: ["splunk"],
    keywords: {
      $pattern: /[A-Za-z_]\w*/,
      keyword: "AND OR NOT XOR by BY as AS over OVER output OUTPUT outputnew OUTPUTNEW"
    },
    contains: [
      hljs.COMMENT("```", "```"),
      // Macros are wrapped in single backticks: `macro_name(arg)`.
      { scope: "meta", begin: /`/, end: /`/ },
      hljs.QUOTE_STRING_MODE,
      {
        match: [/\|/, /\s*/, new RegExp(`(?:${SPL_COMMANDS.join("|")})\\b`)],
        scope: { 1: "punctuation", 3: "keyword" }
      },
      { scope: "built_in", match: /\b[A-Za-z_]\w*(?=\()/ },
      { scope: "variable", match: /[A-Za-z_][\w.:]*(?=\s*(?:[!<>=]=|=))/ },
      { scope: "variable", begin: /'/, end: /'/ },
      { scope: "number", match: /(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])/ },
      { scope: "punctuation", match: /[|[\]]/ }
    ]
  };
}
