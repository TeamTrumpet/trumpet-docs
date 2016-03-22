var express = require('express');
var router = express.Router();
var aglio = require('aglio');
var github = require('octonode');

var NodeCache = require("node-cache");
var cache = new NodeCache();

cache.wrap = function(key, work, done) {
  this.get(key, (err, value) => {
    if (err) {
      return done(err);
    }

    if (value !== undefined) {
      return done(null, value);
    }

    work((err, value) => {
      if (err) {
        return done(err);
      }

      this.set(key, value, (err) => {
        if (err) {
          return done(err);
        }

        return done(err, value);
      });
    });
  });
};

var ensureAuthenticated = function(req, res, next) {
  if (req.isAuthenticated())
    return next();
  else
    return res.redirect('/auth/google?next=' + req.url);
};

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

var generateCacheKey = (repo, ref, docs_path) => `${repo}?ref=${ref}&docs_path=${docs_path ? docs_path : process.env.DOCS_PATH}`;

var generateDocsHTML = (repo, ref, docs_path) => (callback) => {
  var client = github.client(process.env.GITHUB_TOKEN);

  var ghrepo = client.repo(repo);

  ghrepo.contents(docs_path ? docs_path : process.env.DOCS_PATH, ref, function(err, data) {
    if (err) {
      return callback(err);
    }

    var blueprint = new Buffer(data.content, 'base64').toString('utf8');

    var options = {};

    aglio.render(blueprint, options, function(err, html) {
        if (err) {
          return callback(err);
        }

        // ensure all assets are https
        html = html.replace(/http\:\/\//g, 'https://');

        return callback(null, html);
    });
  });
};

router.get('/docs/:owner/:repository', ensureAuthenticated, function(req, res, next) {
  var repo = `${req.params.owner}/${req.params.repository}`;
  var ref = 'master';

  if (req.query.ref) {
    ref = req.query.ref;
  }

  cache.wrap(generateCacheKey(repo, ref), generateDocsHTML(repo, ref), (err, html) => {
    if (err) {
      return next(err);
    }

    return res.send(html);
  });
});

router.post('/', function(req, res) {
  if (req.query.all) {
    cache.flushAll();
    return res.status(204).end();
  }

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

  // and delete the cache element
  cache.del(generateCacheKey(repo, ref));

  return res.status(200).end();
});

module.exports = router;
