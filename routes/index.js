var express = require('express');
var router = express.Router();
var aglio = require('aglio');
var github = require('octonode');
var cache = require('memory-cache');

var ensureAuthenticated = function(req, res, next) {
  if (req.isAuthenticated())
    return next();
  else
    return res.redirect('/auth/google?next=' + req.url);
};

router.post('/', function(req, res) {
  // if it queried for all keys to be deleted
  if (req.query.all) {
    cache.clear();
    console.log("CACHE CLEARED <ALL KEYS>");
    return res.status(204).end();
  }

  // TODO: Add secret parsing
  var repo = req.body.repository.full_name;
  var ref = 'master';

  // if the push event has a ref
  if (req.body.ref) {
    // Example Procedure
    // req.body.ref === 'refs/heads/develop'
    // refsplit = ['refs', 'heads', 'develop']
    // ref = 'develop'
    var refsplit = req.body.ref.split('/');

    // and it has three components
    if (refsplit.length == 3) {
      // then we'll update our ref to that last piece
      ref = refsplit[2];
    }
  }

  // build our cache key
  var CACHE_KEY = repo + '?ref=' + ref;

  // and delete the cache element
  cache.del(CACHE_KEY);

  console.log("CACHE CLEARED " + CACHE_KEY);

  return res.status(200).end();
});

router.get('/', ensureAuthenticated, function(req, res) {
  // if some params are specified
  if (req.query.owner || req.query.repository || req.query.ref) {

    // then check if all are specified
    if (req.query.owner && req.query.repository && req.query.ref) {
      // if they are, then send them on to the docs
      return res.redirect('/docs/' + req.query.owner + '/' + req.query.repository + '?ref=' + req.query.ref);
    }

    var owner = process.env.DEFAULT_OWNER;

    if (req.query.owner) {
      owner = req.query.owner;
    }

    // otherwise, there's an issue
    return res.render('index', { error: true, owner: owner, repository: req.query.repository, ref: req.query.ref });

  }

  return res.render('index', { error: false, owner: process.env.DEFAULT_OWNER, repository: "", ref: "master" });
});

router.get('/docs/:owner/:repository', ensureAuthenticated, function(req, res, next) {

  var repo = req.params.owner + '/' + req.params.repository;
  var ref = 'master';

  if (req.query.ref) {
    ref = req.query.ref;
  }

  var CACHE_KEY = repo + '?ref=' + ref;

  var html = cache.get(CACHE_KEY);

  if (html) {
    console.log("CACHE GET " + CACHE_KEY);
    return res.send(html);
  } else {
    var client = github.client(process.env.GITHUB_TOKEN);

    var ghrepo = client.repo(repo);

    ghrepo.contents(process.env.DOCS_PATH, ref, function(err, data) {
      if (err) {
        if (err.statusCode === 404) {
          console.log("Not Found: " + CACHE_KEY);
          return res.status(404).send("Not found");
        }

        console.error(err);
        res.status(500).send("An error occured.");
        return;
      }

      var blueprint = new Buffer(data.content, 'base64').toString('utf8');

      var options = {};

      aglio.render(blueprint, options, function(err, html) {
          if (err) {
            console.error(err);
            return res.status(500);
          }

          // ensure all assets are https
          html = html.replace(/http\:\/\//g, 'https://');

          cache.put(CACHE_KEY, html);
          console.log("CACHE POPULATED " + CACHE_KEY);

          return res.send(html);
      });
    });
  }
});

module.exports = router;
