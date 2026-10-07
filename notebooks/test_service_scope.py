import copy,json,unittest
from pathlib import Path
from prepare_service_scope import classify_scope,select_fresh

class ScopeTests(unittest.TestCase):
    policy={'include_categories':['Tools','Toys & Hobbies'], 'exclude_title_patterns':{'industrial':'(?i)forklift'}}
    def row(self,id,title='Mixed-material ambiguous kit',category='Tools'):
        return {'id':id,'product':{'title':title,'description':'missing material','category':category},'metadata':{'top_category':category}}
    def test_difficult_in_scope_products_retained(self):
        self.assertEqual(classify_scope(self.row('a'),self.policy)[0],'include')
        self.assertEqual(classify_scope(self.row('b','Forklift hydraulic cage'),self.policy)[0],'exclude')
    def test_selection_independent_of_labels_predictions_order(self):
        rows=[self.row(str(i),category='Tools' if i%2 else 'Toys & Hobbies') for i in range(20)]
        chosen=select_fresh(rows,{'1','2'},10)
        modified=copy.deepcopy(rows)
        for r in modified:r.update(reference_hs6='999999',prior_prediction='correct')
        self.assertEqual([r['id'] for r in chosen],[r['id'] for r in select_fresh(modified[::-1],{'1','2'},10)])
        self.assertFalse({'1','2'}&{r['id'] for r in chosen})
        self.assertEqual(len({r['id'] for r in chosen}),10)

if __name__=='__main__':unittest.main()
