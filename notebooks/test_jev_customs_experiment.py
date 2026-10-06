import os
import tempfile
import unittest
from pathlib import Path
from jev_customs_experiment import Experiment, criteria_for, validate_answer

class ExperimentTests(unittest.TestCase):
    def setUp(self):
        self.old = os.environ.get('TYPESAFEAI_API_KEY')
        os.environ['TYPESAFEAI_API_KEY'] = 'offline-test-placeholder'
        self.criteria = {'95': 'Games', 'needs_information': 'Missing facts'}
    def tearDown(self):
        if self.old is None:
            os.environ.pop('TYPESAFEAI_API_KEY', None)
        else:
            os.environ['TYPESAFEAI_API_KEY'] = self.old
    def fake(self, provider, payload):
        return {'model':'jev-1.13.0','answers':{'hs':{'choice':'95','probabilities':{'95':1.0,'needs_information':0.0},'confidence':1.0}},'usage':{'input_tokens':20,'output_tokens':10}}
    def test_budget_cache_and_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            calls=[]
            def transport(p, q):
                calls.append(q)
                return self.fake(p,q)
            exp=Experiment(folder,live=True,max_calls=1,transport=transport)
            first=exp.evaluate('jev',{'title':'cards'},self.criteria)
            self.assertFalse(first['cache_hit'])
            restart=Experiment(folder,live=True,max_calls=1,transport=transport)
            self.assertTrue(restart.evaluate('jev',{'title':'cards'},self.criteria)['cache_hit'])
            self.assertEqual(len(calls),1)
            self.assertFalse(Experiment(folder).evaluate('jev',{'title':'cards'},self.criteria)['live'])
            with self.assertRaisesRegex(RuntimeError,'budget_or_call'):
                restart.evaluate('jev',{'title':'different'},self.criteria)
    def test_failure_never_silently_retries(self):
        with tempfile.TemporaryDirectory() as folder:
            def transport(p,q):
                raise RuntimeError('jev_transport_error_no_retry')
            exp=Experiment(folder,live=True,transport=transport)
            with self.assertRaises(RuntimeError):
                exp.evaluate('jev',{},self.criteria)
            with self.assertRaisesRegex(RuntimeError,'previous_request'):
                exp.evaluate('jev',{},self.criteria)
            self.assertEqual(sum(r['event']=='reserved' for r in exp.records),1)
    def test_dry_run_has_no_transport(self):
        with tempfile.TemporaryDirectory() as folder:
            exp=Experiment(folder,transport=lambda *_: self.fail('network called'))
            self.assertFalse(exp.evaluate('jev',{},self.criteria)['live'])
            self.assertFalse(Path(folder,'requests.jsonl').exists())
    def test_invalid_probabilities_and_choice(self):
        for answer in [ {'choice':'invented'}, {'choice':'95','probabilities':{'95':0.9,'needs_information':0.9},'confidence':0.9} ]:
            with self.assertRaises(ValueError):
                validate_answer(answer,self.criteria,'jev')
    def test_inclusive_probability_sum_boundary(self):
        answer={'choice':'95','probabilities':{'95':.79,'needs_information':.20},'confidence':.8}
        self.assertEqual(validate_answer(answer,self.criteria,'jev')['choice'],'95')
        answer['probabilities']['needs_information']=.19
        with self.assertRaises(ValueError):validate_answer(answer,self.criteria,'jev')
    def test_option_overflow_not_truncated(self):
        taxonomy={'entries':[{'code':str(i),'parent':None,'description':'x'} for i in range(254)]}
        with self.assertRaises(ValueError):
            criteria_for(taxonomy)


class WorkflowTests(unittest.TestCase):
    def test_llm_parsing_hierarchy_and_abstention(self):
        import json
        from jev_customs_experiment import classify_hierarchy
        old=os.environ.get('OPENAI_API_KEY')
        os.environ['OPENAI_API_KEY']='offline-test-placeholder'
        taxonomy={'entries':[{'code':'95','parent':None,'description':'games'},
                             {'code':'9504','parent':'95','description':'games'},
                             {'code':'950440','parent':'9504','description':'playing cards'}]}
        try:
            with tempfile.TemporaryDirectory() as folder:
                def transport(provider,payload):
                    state=json.loads(payload['input'])['state']
                    choice={2:'95',4:'9504',6:'950440'}[state['hs_level']]
                    return {'status':'completed','model':'test-model','output':[{'content':[{'type':'output_text','text':json.dumps({'choice':choice})}]}],
                            'usage':{'input_tokens':10,'output_tokens':5}}
                exp=Experiment(folder,live=True,transport=transport)
                result=classify_hierarchy(exp,'llm',{'title':'playing cards'},taxonomy)
                self.assertEqual(result['path'],['95','9504','950440'])
                self.assertFalse(result['rate_verified'])
                self.assertEqual(len(result['steps']),3)
                def abstain(provider,payload):
                    return {'status':'completed','output':[{'content':[{'type':'output_text','text':'{"choice":"needs_information"}'}]}],
                            'usage':{'input_tokens':10,'output_tokens':5}}
                exp.transport=abstain
                held=classify_hierarchy(exp,'llm',{'title':'unknown item'},taxonomy)
                self.assertEqual(held['status'],'needs_information')
                self.assertEqual(held['path'],[])
                self.assertEqual(len(held['steps']),1)
        finally:
            if old is None: os.environ.pop('OPENAI_API_KEY',None)
            else: os.environ['OPENAI_API_KEY']=old

if __name__ == '__main__':
    unittest.main()
