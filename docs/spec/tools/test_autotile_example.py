"""Checks the autotiling rules in docs/spec/editor/autotiling.md and its example.

Expected tile numbers below are read by hand from the spec's table (1.2), not
computed by the builder, so a wrong rule in the builder fails here.
"""
import os
import unittest

import build_autotile_example as A
import rpgtk_formats as F

W = 'AUTOTILES_Water.tst'


def lay(text):
    """'#' cells of a small board -> {(x, y): tile} by the final-state rule."""
    rows = text.split()
    sets = {(x, y): W for y, r in enumerate(rows) for x, c in enumerate(r) if c == '#'}
    return {p: A.tile_for_cell(sets, *p) for p in sets}


class SpecTableTests(unittest.TestCase):
    def test_table_is_47_distinct_corner_gated_shapes_in_52_slots(self):
        self.assertEqual(len(A.TABLE), 47)
        self.assertEqual(A.UNUSED, [9, 18, 27, 36, 45])
        self.assertEqual(len(set(A.TABLE.values())), 47)
        self.assertTrue(all(A.gate(m) == m for m in A.TABLE.values()))
        self.assertEqual(set(A.TABLE.values()), {A.gate(m) for m in range(256)})


class RuleTests(unittest.TestCase):
    def test_isolated_cell_is_51(self):
        self.assertEqual(lay('... .#. ...')[(1, 1)], 51)

    def test_two_side_by_side_are_48_and_50(self):
        got = lay('.... .##. ....')
        self.assertEqual((got[(1, 1)], got[(2, 1)]), (48, 50))

    def test_full_block(self):
        got = lay('### ### ###')
        self.assertEqual(got[(1, 1)], 52)   # N S W E, all corners
        self.assertEqual(got[(0, 0)], 38)   # S E | SE
        self.assertEqual(got[(1, 0)], 22)   # S W E | SW SE
        self.assertEqual(got[(2, 2)], 42)   # N W | NW

    def test_plus_has_no_corners(self):
        self.assertEqual(lay('.#. ### .#.')[(1, 1)], 16)

    def test_inner_corner(self):
        self.assertEqual(lay('##. ### ###')[(1, 1)], 2)    # N S W E | NW SW SE (NE missing)

    def test_corner_only_contact_does_not_connect(self):
        got = lay('#. .#')
        self.assertEqual((got[(0, 0)], got[(1, 1)]), (51, 51))

    def test_board_edge_never_connects(self):
        got = lay('... ###')                       # a strip along the bottom edge
        self.assertEqual([got[(x, 1)] for x in range(3)], [48, 37, 50])


class ClickTests(unittest.TestCase):
    def paint(self, cells, w, h):
        board, sets = {}, {}
        for x, y in cells:
            A.click(board, sets, x, y, w, h, W)
        return board

    def test_painting_order_does_not_matter(self):
        sets, w, h = A.marsh_cells()
        final = {p: A.tile_for_cell(sets, *p) for p in sets}
        cells = sorted(sets, key=lambda p: (p[1], p[0]))
        self.assertEqual(self.paint(cells, w, h), final)
        self.assertEqual(self.paint(cells[::-1], w, h), final)

    def test_first_click_seeds_51_then_erase_closes_the_hole(self):
        board, sets = {}, {}
        A.click(board, sets, 1, 1, 3, 3, W)
        self.assertEqual(board, {(1, 1): 51})
        for p in [(0, 1), (2, 1)]:
            A.click(board, sets, *p, 3, 3, W)
        self.assertEqual(board[(1, 1)], 37)        # W E
        A.click(board, sets, 1, 1, 3, 3, None)
        self.assertEqual((board[(0, 1)], board[(2, 1)]), (51, 51))


class ExampleFileTests(unittest.TestCase):
    def test_committed_example_matches_the_builder(self):
        for name, data in A.build().items():
            r = F.Reader(data, name)
            (F.parse_brd if name.endswith('.brd') else F.parse_tst)(r)
            self.assertTrue(r.at_eof(), name)
            with open(os.path.join(A.OUT, name), 'rb') as f:
                self.assertEqual(f.read(), data, f'{name} is out of date; run build_autotile_example.py')


if __name__ == '__main__':
    unittest.main()
