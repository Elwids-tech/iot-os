import contextlib
import io
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_links  # noqa: E402


class Repository:
    def __init__(self, test):
        self.directory = tempfile.TemporaryDirectory()
        test.addCleanup(self.directory.cleanup)
        self.root = self.directory.name
        subprocess.run(["git", "init", "-q", self.root], check=True)

    def write(self, rel, text):
        path = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as stream:
            stream.write(text)

    def check(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            status = check_links.main(["--root", self.root])
        return status, output.getvalue()


class CheckLinksTest(unittest.TestCase):
    def test_resolving_links_and_reachable_docs_pass(self):
        repo = Repository(self)
        repo.write("docs/README.md", "[Guide](guide.md#set-up-the-stack)\n")
        repo.write("docs/guide.md", "# Guide\n\n## Set up the stack\n")
        status, output = repo.check()
        self.assertEqual(0, status, output)
        self.assertIn("PASS 2 Markdown files", output)

    def test_a_missing_file_fails_with_its_location(self):
        repo = Repository(self)
        repo.write("docs/README.md", "intro\n\nsee [old](gone.md)\n")
        status, output = repo.check()
        self.assertEqual(1, status)
        self.assertIn("docs/README.md:3: missing target gone.md", output)

    def test_anchors_follow_github_slug_rules(self):
        repo = Repository(self)
        repo.write("docs/README.md", "[a](ref.md#74-catalogue-entry-contractsinternalcataloguejson) [b](ref.md#api-1)\n")
        repo.write("docs/ref.md", "### 7.4 Catalogue entry (`contracts/internal/catalogue.json`)\n## API\n## API\n")
        status, output = repo.check()
        self.assertEqual(0, status, output)

    def test_an_anchor_that_keeps_a_dot_fails(self):
        repo = Repository(self)
        repo.write("docs/README.md", "[a](ref.md#catalogue.json)\n")
        repo.write("docs/ref.md", "## catalogue.json\n")
        status, output = repo.check()
        self.assertEqual(1, status)
        self.assertIn("no heading for #catalogue.json in docs/ref.md", output)

    def test_links_in_code_blocks_and_external_links_are_ignored(self):
        repo = Repository(self)
        repo.write("docs/README.md", "```\n[x](nowhere.md)\n```\n`[y](nope.md)` [site](https://example.test/missing)\n")
        status, output = repo.check()
        self.assertEqual(0, status, output)

    def test_a_doc_nobody_links_to_fails(self):
        repo = Repository(self)
        repo.write("docs/README.md", "# Docs\n")
        repo.write("docs/lonely.md", "# Lonely\n")
        status, output = repo.check()
        self.assertEqual(1, status)
        self.assertIn("docs/lonely.md: not reachable from docs/README.md", output)

    def test_the_archive_and_in_product_help_routes_are_skipped(self):
        repo = Repository(self)
        repo.write("docs/README.md", "[archive](archive/2026-10/README.md)\n")
        repo.write("docs/archive/2026-10/README.md", "[stale](missing.md)\n")
        repo.write("apps/api/resources/help/devices.md", "[related](/help/alerts)\n")
        repo.write("apps/docs/src/content/docs/docs/page.md", "[route](/docs/guides/devices/)\n")
        status, output = repo.check()
        self.assertEqual(0, status, output)

    def test_a_link_out_of_the_repository_fails(self):
        repo = Repository(self)
        repo.write("docs/README.md", "[up](../../etc/hosts)\n")
        status, output = repo.check()
        self.assertEqual(1, status)
        self.assertIn("leaves the repository", output)


if __name__ == "__main__":
    unittest.main()
