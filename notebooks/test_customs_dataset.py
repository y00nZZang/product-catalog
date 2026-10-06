import unittest
from customs_dataset import model_product,score_hs6

class DatasetTests(unittest.TestCase):
    def test_null_labels_cannot_produce_false_accuracy(self):
        score=score_hs6([{'id':'x','hs6':None}],{'x':{'reference_hs6':None}})
        self.assertIsNone(score['accuracy_all'])
        self.assertEqual(score['reference_cases'],0)
    def test_abstentions_and_missing_results_remain_in_denominator(self):
        labels={'a':{'reference_hs6':'950440'},'b':{'reference_hs6':'490199'},'c':{'reference_hs6':'220830'}}
        score=score_hs6([{'id':'a','hs6':'950440'},{'id':'b','hs6':'needs_information'}],labels)
        self.assertEqual(score['accuracy_all'],1/3)
        self.assertEqual(score['accuracy_answered'],1)
    def test_label_injection_rejected_and_metadata_not_sent(self):
        row={'product':{'title':'test','description':'text'},'reference_hs6':'950440'}
        self.assertNotIn('reference_hs6',model_product(row))
        row['product']['reference_hs6']='950440'
        with self.assertRaises(ValueError):model_product(row)

if __name__=='__main__':unittest.main()
