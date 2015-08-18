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

    ghrepo.contents(process.env.DOCS_PATH, function(err, data) {
      if (err) {
        res.json(err);
        return;
      }

      var blueprint = new Buffer(data.content, 'base64').toString('utf8');

      var options = {

      };

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
