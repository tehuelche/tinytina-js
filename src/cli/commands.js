const { URLSearchParams } = require('url');

const { interactive } = require('./interactive');
const { log_effect } = require('./effects');
const help = require('./help');
const version = require('./version');

const { bind, is_empty, map, reduce } = require('../common/utils');
const Result = require('../common/Result');

function show(fn) {
  return (...args) => log_effect(true, fn, ...args);
}

function show_result(fn) {
  return (...args) => {
    const result = fn.apply(fn, args);

    if (result.is_err) {
      return result;
    }

    return log_effect(true, () => result.unwrap_or(''));
  };
}

function search_requests(reader, state, args) {
  let requests = { success: [], failed: [] };
  for (let query of args) {
    reader.get_requests(state.collection, query).cata(
      result => requests.success.push(result),
      err => requests.failed.push(err)
    );
  }

  if (requests.failed.length) {
    return Result.Err('Search failed:\n' + requests.failed.join('\n'));
  }

  return Result.Ok(requests.success);
}

function run_all(reader, state, config) {
  const create_options = bind(reader.build_fetch_options, state.env);
  let all = reader.get_all_requests(state.collection);

  function _effect({ http }) {
    return http(create_options, config.raw_output)(all);
  }

  return Result.Ok(_effect);
}

function run_collection(reader, state, { config, args }) {
  if (is_empty(args)) {
    return Result.Err({
      message: 'Empty argument list for "run"',
      info: 'To run all requests use the "run-all" command'
    });
  }

  const create_options = bind(reader.build_fetch_options, state.env);

  const requests = search_requests(reader, state, args);

  if (requests.is_err) {
    return requests;
  }

  function _effect({ http }) {
    return Promise.all(
      map(http(create_options, config.raw_output), requests.unwrap_or([]))
    );
  }

  return Result.Ok(_effect);
}

function run_interactive(reader, state, { config, args }) {
  if (args.length > 1 || args[0].requests.length > 1) {
    return Result.Err("Can't process multiple requests in interactive mode");
  }

  const request = reader
    .get_requests(state.collection, args[0])
    .map(res => res[0]);

  if (request.is_err) {
    return request;
  }

  const fetch_options = bind(reader.build_fetch_options, state.env);
  const prompt_options = bind(reader.build_prompt_options, state);

  function _effect(prompt, next_action, { http }) {
    const run = req => http(fetch_options, config.raw_output)([req]);
    return interactive(
      { run, next_action, prompt },
      prompt_options,
      request.unwrap_or({})
    );
  }

  return Result.Ok(_effect);
}

function list(reader, state, { args }) {
  const list = reader.list_requests(state.collection);
  return reader.list_to_string(args[0], list);
}

function convert_to(reader, state, { args, config }) {
  const result = is_empty(args)
    ? Result.Ok(reader.get_all_requests(state.collection))
    : search_requests(reader, state, args).map(reqs => reqs.flat());

  const build_command = reader
    .build_shell_command(URLSearchParams, state, config)
    .map(fn => bind(map, fn));

  return result.ap(build_command).map(arr => arr.join('\n\n'));
}

function doc(reader, state, { config }) {
  return reader.build_doc_markdown(URLSearchParams, state, config);
}

module.exports = {
  run: {
    all: run_all,
    collection: run_collection,
    interactive: run_interactive
  },
  help: show(help),
  version: show(version),
  list: show(list),
  convert_to: show_result(convert_to),
  doc: show(doc)
};
