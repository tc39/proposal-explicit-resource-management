const del = require("del");
const gulp = require("gulp");
const emu = require("gulp-emu");
const livereload = require("gulp-livereload");
const http = require("http");
const st = require("st");

const clean = () => del("docs/**/*");
gulp.task("clean", clean);

const build = () => gulp
    .src(["spec/index.html"])
    .pipe(emu())
    .pipe(gulp.dest("docs"))
    .pipe(livereload());
gulp.task("build", build);

const watch = () => {
    livereload.listen({ basePath: "docs" });
    return gulp.watch(["spec/**/*"], build);
};
gulp.task("watch", watch);

const start = (done) => {
    http.createServer(st({ 
        path: __dirname + '/docs',
        index: 'index.html',
        cache: false
    })).listen(8080, e => {
        if (e) return done(e);
        console.log(`folder "docs" serving at http://localhost:8080`);
        done();
    });
};
gulp.task("start", gulp.parallel(watch, start));

gulp.task("default", build);